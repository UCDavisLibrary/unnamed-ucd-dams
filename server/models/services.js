const api = require('@ucd-lib/fin-node-api');
const {logger, config} = require('@ucd-lib/fin-node-utils');
const request = require('request');
const fs = require('fs');
const {URL} = require('url');
const activeMqProxy = require('../lib/activeMqProxy');
const jsonld = require('jsonld');
const transform = require('./transform');
const util = require('util');
const redis = require('../lib/redisClient');
const jwt = require('jsonwebtoken');
const hdt = require('../lib/hdt');
const auth = require('./auth');

jsonld.frame = util.promisify(jsonld.frame);

const FIN_URL = new URL(config.server.url);
const SERVICE_CHAR = '/svc:';
const AUTHENTICATION_SERVICE_CHAR = '^/auth';
const IS_SERVICE_URL = new RegExp(SERVICE_CHAR, 'i');
const IS_AUTHENTICATION_SERVICE_URL = new RegExp(AUTHENTICATION_SERVICE_CHAR, 'i');
const ACTIVE_MQ_HEADER_ID = 'org.fcrepo.jms.identifier';
const SECRET_PREFIX = 'service-secret:';

class ServiceModel {

  constructor() {
    this.reloadTimer = -1;
    
    this.services = {};
    this.secrets = {};
    this.SIGNATURE_HEADER = 'X-FIN-SERVICE-SIGNATURE';

    this.SERVICE_ROOT = api.getBaseUrl({path : api.service.ROOT});

    // list of auth service domain names
    this.authServiceDomains = {};

    // timer ids for sending http notifications
    this.notificationTimers = {};
  }

  /**
   * @method init
   * @description ensure the default services are added to server
   * 
   * @returns {Promise}
   */
  async init() {
    this.clientService = null;

    // make sure our root service container is in place
    await api.service.init();
    // let list = await api.service.list();

    // ensure all default services
    for( var i = 0; i < config.defaultServices.length; i++ ) {
      let service = config.defaultServices[i];

      // switching to a force attempt delete strategy in case system is in bad state
 
      // var response = await api.head({
      //   path : '/'+api.service.ROOT+'/'+service.id
      // });

      // if( response.checkStatus(200) ) {
      //   response = await api.delete({
      //     path: '/'+api.service.ROOT+'/'+service.id,
      //     permanent: true
      //   })
      // }

      try {
        await api.delete({
          path: '/'+api.service.ROOT+'/'+service.id,
          permanent: true
        });
      } catch(e) {};

      if( service.type === api.service.TYPES.TRANSFORM ) {
        service.transform = fs.readFileSync(service.transform, 'utf-8');
      }

      let response = await api.service.create(service);
      if( !response.checkStatus(204) ) {
        logger.warn(`Service ${service.id} may not have initialized correctly.  Returned status code: ${response.last.statusCode}`);
      }

      if( service.secret ) {
        await this.setServiceSecret(service.id, service.secret);
      }
    }

    // clone our current redis connection to setup a listener
    redis.duplicate((err, listenerClient) => {
      if( err ) throw new Error('Failed to setup redis sync for service secrets');

      // handle updates to the admin key which we have subscribed to below
      listenerClient.on('pmessage', async (channel, message) => {
        await this.reloadSecrets();
      });

      // listen for updates to the admin key
      listenerClient.psubscribe(`__keyspace@*__:${SECRET_PREFIX}*`, function (err) {
        if( err ) throw new Error('Failed to setup redis sync for admin list');
      });
    });  

    // reload all service secrets from redis
    await this.reloadSecrets();

    // update hdt cache files
    hdt.init();

    // this is triggered by updating default services above
    // reload all service definitions from fedora
    if( !config.defaultServices.length ) {
      await this.reload();
    }

    // listen for service definition updates
    activeMqProxy.on('fcrepo-event', e => this._onFcrepoEvent(e));
    activeMqProxy.connect();
  }

  /**
   * @method reload
   * @description reload all services from root service container
   * 
   * @param {String} testingPath for testing only.  When a none root .services container is
   * updated, it will be included in the known services.  THIS IS FOR TESTING ONLY.
   * 
   * @return {Promise}
   */
  async reload(testingPath) {
    let list = await api.service.list();
    list = list.data;

    // for testing only.  load the testing path services as well.
    // these will be overridden when a testing path is not provided
    if( testingPath ) {
      api.service.testing();
      try {
        let response = await api.service.list();
        list = list.concat(response.data);
      } catch(e) {}
      api.service.testing(false);
    }

    let services = {
      // hardcoded collection label service
      label : new ServiceDefinition({type: 'label'})
    };
    this.authServiceDomains = {};
    
    for( var i = 0; i < list.length; i++ ) {
      let service = list[i];

      if( service.type === api.service.TYPES.TRANSFORM ) {
        let response = await api.get({path: service.path});
        service.transform = response.last.body;
      }

      services[service.id] = new ServiceDefinition(service);

      if( service.type === api.service.TYPES.CLIENT ) {
        this.clientService = services[service.id];
      } else if( service.type === api.service.TYPES.EXTERNAL ) {
        let domain = this.getRootDomain(service.urlTemplate);
        this.authServiceDomains[domain] = new RegExp(domain+'$', 'i');
      } else if( service.type === api.service.TYPES.TRANSFORM ) {
        await transform.load(service.id, service.transform);
      }
    };

    this.services = services;
    logger.info('Services reloaded', Object.keys(services));

    // run init
    for( let id in this.services ) {
      this.services[id].init(this);
    }
  }

  /**
   * @method bufferedReload
   * @description just like reload but buffers request for 1 sec
   * 
   * @param {String} testingPath for testing only.  When a none root .services container is
   * updated, it will be included in the known services.  THIS IS FOR TESTING ONLY.
   */
  bufferedReload(testingPath) {
    if( this.reloadTimer !== -1 ) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = -1;
      this.reload(testingPath);
    }, 300);
  }

  /**
   * @method isServiceRequest
   * @description does the given request have a originalUrl that matches a service request url?
   * 
   * @param {Object} req http request object
   * @returns {Boolean} 
   */
  isServiceRequest(req) {
    return req.originalUrl.match(IS_SERVICE_URL);
  }

  /**
   * @method isAuthenticationServiceRequest
   * @description does the given request have a originalUrl that matches a authentication service request url?
   * 
   * @param {Object} req http request object
   * @returns {Boolean} 
   */
  isAuthenticationServiceRequest(req) {
    return req.originalUrl.match(IS_AUTHENTICATION_SERVICE_URL);
  }

  /**
   * @method setServiceLinkHeaders
   * @description given an array of links and the current fcPath, append on the link headers
   * 
   * @param {Array} links array of current links
   * @param {String} fcPath current fedora container path
   * @param {Array} types current links for path
   */
  setServiceLinkHeaders(links, fcPath, types) {
    fcPath = fcPath.replace(/\/^/, '');

    for( var id in this.services ) {
      let service = this.services[id];
      if( service.type === api.service.TYPES.WEBHOOK ) continue;
      if( service.type === api.service.TYPES.AUTHENTICATION ) continue;
      if( service.type === api.service.TYPES.CLIENT ) continue;
      if( service.type === api.service.TYPES.PROXY && !service.urlTemplate ) continue;
      if( service.type === api.service.TYPES.EXTERNAL && !service.urlTemplate ) continue;

      if( !this._supportedTypeInType(service.supportedTypes, types) ) {
        continue;
      }

      links.push(`<${config.server.url}${fcPath}/svc:${id}>; rel="service" type="${service.type}"`);
    }
  }

  /**
   * @method _supportedTypeInType
   * @description given a list of supported types of a serivce, is on of
   * the fcrepo container types in the list
   * 
   * @param {Array} supportedTypes types the service supports
   * @param {Array} types list of types for the container
   * 
   * @return {Boolean}
   */
  _supportedTypeInType(supportedTypes, types) {
    if( !supportedTypes.length ) return true;

    for( var i = 0; i < supportedTypes.length; i++ ) {
      if( types.indexOf(supportedTypes[i]) > -1 ) return true;
    }
    return false;
  }


  /**
   * @method parseServiceRequest
   * @description given a ExpressJS Request object, parse out the service parameters.  These are of 
   * the form: http://my-host.org/[fcPath]/svc:[name]/[svcPath]
   * 
   * @param {Object} req Express Request
   * 
   * @returns {Object} service request information object
   */
  parseServiceRequest(req) {
    let parts = req.originalUrl.split(SERVICE_CHAR);

    let serviceRequest = {
      fcUrl : config.server.url+req.originalUrl.replace(new RegExp(SERVICE_CHAR+'.*'), ''),
      fcPath : parts[0],
      name : '',
      svcPath : ''
    }

    parts = parts[1].split('/');
    serviceRequest.name = parts.shift();
    serviceRequest.svcPath = parts.length > 0 ? '/'+parts.join('/') : '';

    return serviceRequest
  }

  /**
   * @method renderFrame
   * @description render a json-ld frame service
   * 
   * @param {String} service service name
   * @param {String} path fcrepo path to render
   * 
   * @returns {Promise} resolves to framed json-ld
   */
  async renderFrame(service, path) {
    if( !this.services[service] ) throw new Error('Unknown service: '+service);
    if( !this.services[service].frame ) throw new Error(`Serivce ${service} has no registered frame`);
    let frame = this.services[service].frame;

    let options = {
      path : path,
      headers : {
        Accept : api.RDF_FORMATS.JSON_LD,
        Forwarded : this.getForwardedHeader()
      }
    }

    let response = await api.get(options);
    if( !response.checkStatus(200) ) throw new Error(response.last.statusCode+' '+response.last.body);

    let container = JSON.parse(response.last.body);
    return await jsonld.frame(container, frame);
  }

  /**
   * @method renderTransform
   * @description given a service definition and or string path to a container or
   * a object, transform either the object or the JSON-LD representation of the container.
   * 
   * @param {Object} service
   * @param {Object|String} pathOrData
   */
  renderTransform(service, pathOrData) {
    return transform.exec(service, pathOrData)
  }

  renderLabel(fcPath, svcPath = '') {
    let collection = fcPath.split('/')[2];
    let uri = decodeURIComponent(svcPath.replace(/^\//, ''));
    return hdt.getSubjects(collection, uri);
  }

  /**
   * @method createWorkflowContainer
   * @description create a new container for a workflow, return the pair tree id
   * 
   * @return {Promise} resolves to id
   */
  async createWorkflowContainer(service, username) {
    if( !config.workflow ) {
      config.workflow = {root: '/.workflow'}
    }

    let response = await api.head({path: config.workflow.root});
    if( response.checkStatus(404) ) {
      response = await api.postEnsureSlug({
        path : '/',
        slug: config.workflow.root.replace(/^\//, '')
      });

      // TODO: check status code
    }

    let jsonld = [{
      "@id" : '',
      "@type": [
        "http://digital.ucdavis.edu/schema#Workflow"
      ],
      "http://digital.ucdavis.edu/schema#workflowServiceId": [{
        "@value" : service.id,
      }],
      "http://digital.ucdavis.edu/schema#workflowServiceType": [{
        "@value" : service.type,
      }],
      "http://schema.org/status": [{
        "@value": "init"
      }],
      "http://schema.org/creator": [{
        "@value": username
      }]
    }]

    response = await api.post({
      path : config.workflow.root,
      headers : {
        'content-type': 'application/ld+json'
      },
      content : JSON.stringify(jsonld)
    });

    if( !response.checkStatus(201) ) {
      throw new Error(`Unable to create LDP workflow.  HTTP ${response.last.statusCode}: ${response.last.body}`);
    }

    return response.last.body.replace(/.*fcrepo\/rest/, '');
  }
  
  /**
   * @method getForwardedHeader
   * @description return the forwarded header for fcrepo responses that represent actual domain
   * name and protocol, not docker fcrepo:8080 name.
   * 
   * @returns {String}
   */
  getForwardedHeader() {
    return `host=${FIN_URL.host}; proto=${FIN_URL.protocol.replace(/:/, '')}`;
  }

  /**
   * @method getRootDomain
   * @description given a url string, return the root domain name. So for
   * http://sub.host.com/foo would return host.com.
   * 
   * @param {String} url
   * 
   * @returns {String}
   */
  getRootDomain(url) {
    if( !url.match(/^http/) ) url = 'http://'+url;
    url = new URL(url.replace(/{{.*/, ''));
    let parts = url.hostname.replace(/\.$/, '').split('.');
    // let parts = url.host.replace(/\.$/, '').split('.');
    if( parts.length === 1) return parts[0];
    return parts.splice(parts.length-2, parts.length-1).join('.').toLowerCase();
  }
  
  /**
   * @method _onFcrepoEvent
   * @description called from event listener on activeMqProxy.  called whenever
   * a 'fcrepo-event' is emitted.  These come from ActiveMQ events.  Either reloads
   * service definitions if .service path, ignore is .[name] path or sends HTTP
   * webhook notification
   * 
   * @param {Object} event
   */
  _onFcrepoEvent(event) {
    let id = event.payload.headers[ACTIVE_MQ_HEADER_ID];

    // this is a service update, reload services
    let serviceIndex = id.indexOf('/'+api.service.DEFAULT_ROOT);
    let testingServiceIndex = id.indexOf('/integration-test/'+api.service.DEFAULT_ROOT);
    if( serviceIndex === 0 || testingServiceIndex === 0 ) {
      this.bufferedReload(testingServiceIndex === 0 ? id : null);
      return;
    }

    if( id.match(/^\/collection\/[\w-_]+$/) ) {
      hdt.onCollectionUpdate(id.replace('/collection/', ''));
    }

    // see if we need to update in memory acl
    auth.onContainerUpdate(event);

    this._sendHttpNotificationBuffered(event);
  }

  /**
   * @method _sendHttpNotificationBuffered
   * @description we want to debounce event notifications.  ie we want to let events
   * for a certain path settle before we send notifications so listeners are hammer
   * fin server requests as updates happen on the same path.
   * 
   * @param {Object} event 
   */
  _sendHttpNotificationBuffered(event) {
    let id = event.payload.headers[ACTIVE_MQ_HEADER_ID];

    if( this.notificationTimers[id] ) {
      clearTimeout(this.notificationTimers[id].timer);
    }

    // we need to save creation events
    let eventType = event.payload.headers['org.fcrepo.jms.eventType'];

    let timer = setTimeout(() => {
      event.payload.headers['org.fcrepo.jms.eventType'] = this.notificationTimers[id].eventType;
      delete this.notificationTimers[id];

      this.sendWebhookNotification(event);
    }, 10 * 1000);

    // if there is a buffered event and it is a creation event, and there is a new event
    // that is a modification event, set the type as creation.
    if( this.notificationTimers[id] && 
        this.notificationTimers[id].eventType.indexOf('ResourceCreation') > -1 &&
        eventType.indexOf('ResourceModification') > -1 ) {
      eventType = this.notificationTimers[id].eventType;
    }

    this.notificationTimers[id] = {
      timer,
      eventType
    } 
  }

  /**
   * @method sendWebhookNotification
   * @description broadcase a webhook notification to all webhook services
   * 
   * @param {Object} event
   * @param {String} event.type webhook event type
   * @param {Object} event.payload webhook event payload
   */
  sendWebhookNotification(event) {
    for( let serviceId in this.services ) {
      let service = this.services[serviceId];
      if( service.type !== 'WebhookService' ) continue;

      this._sendHttpNotification(serviceId, service.url, event);
    }
  }

  /**
   * @method _sendHttpNotification
   * @description send a HTTP webhook notification.  we don't really care about the response
   * unless there is an error, then log it.
   * 
   * @param {String} id service name
   * @param {String} url webhook url to post to
   * @param {Object} event event payload
   */
  _sendHttpNotification(id, url, event) {
    logger.debug(`Sending HTTP webhook notifiction to service ${id} ${url}`);

    request({
      type : 'POST',
      uri : url,
      headers : {
        [this.SIGNATURE_HEADER] : this.createServiceSignature(id),
        'Content-Type': 'application/json'
      },
      body : JSON.stringify(event)
    },
    (error, response, body) => {
      if( error ) return logger.error(`Failed to send HTTP notification to service ${id} ${url}`, error);
      if( !api.isSuccess(response) ) {
        logger.error(`Failed to send HTTP notification to service ${id} ${url}`, response.statusCode, response.body);
      }
    });
  }

  /**
   * @method reloadSecrets
   * @description reload service secrets from redis
   */
  async reloadSecrets() {
    let secrets = {};

    let keys = await redis.keys(SECRET_PREFIX+'*');
    for( let i = 0; i < keys.length; i++ ) {
      let name = keys[i].replace(SECRET_PREFIX, '');
      let secret = await redis.get(keys[i]);
      secrets[name] = secret;
    }

    this.secrets = secrets;
  }

  /**
   * @method setServiceSecret
   * @description store a secret for a service
   * 
   * @param {String} id service id
   * @param {String} secret service secret
   * 
   * @returns {Promise}
   */
  setServiceSecret(id, secret) {
    if( !id ) throw Error('Service id required');
    this.secrets[id] = secret;
    return redis.set(SECRET_PREFIX+id, secret);
  }
  
  /**
   * @method deleteServiceSecret
   * @description delete a secret for a service
   * 
   * @param {String} id service id
   * 
   * @returns {Promise}
   */
  deleteServiceSecret(id) {
    if( !id ) throw Error('Service id required');
    if( this.secrets[id] ) delete this.secrets[id];
    return redis.del(SECRET_PREFIX+id);
  }

  /**
   * @method createServiceSignature
   * @description create a signature (jwt token) for a service with the
   * service name, type and encrypted with either the provided service 
   * secret or the jwt
   * 
   * @param {String} id service id
   * @param {Object} req (optional) express request.  will set header on
   * request if provided
   * 
   * @returns {String} jwt token for signature
   */
  createServiceSignature(id, additionParams={}, req) {
    let service = this.services[id];
    if( !service ) {
      throw new Error('Unable to create signature for unknown service: '+id);
    }

    let secret = this.secrets[id];

    let signature = jwt.sign(Object.assign(additionParams, {
        service : id,
        type: service.type,
        signer : secret ? id : 'fin'
      }), 
      secret || config.jwt.secret,
      {
        issuer: config.jwt.issuer,
        expiresIn: 60*60
      }
    );

    if( req ) {
      req.set(this.SIGNATURE_HEADER, signature);
    }

    return signature;
  }

  /**
   * @method _isDotPath
   * @description check to see if there is a folder name that starts with a dot.
   * if so, it's a dot path
   * 
   * @param {String} path url path to check
   * 
   * @returns {String} first part of path with dot 
   */
  _isDotPath(path) {
    if( path.match(/^http/i) ) {
      let urlInfo = new URL(path);
      path = urlInfo.pathname;
    }
    
    path = path.split('/');
    for( var i = 0; i < path.length; i++ ) {
      if( path[i].match(/^\./) ) {
        return path[i];
      }
    }
    
    return null;
  }

}

class ServiceDefinition {

  constructor(data = {}) {
    this.type = data.type || '';
    this.frame = data.frame || '';
    this.urlTemplate = data.urlTemplate || '';
    this.multiRouteTemplate = data.multiRouteTemplate ? true : false;
    this.protected = data.protected === true ? true : false;
    this.url = data.url || '';
    this.title = data.title || '';
    this.description = data.description || '';
    this.transform = data.transform || '';
    this.supportedTypes = data.supportedTypes || [];
    this.id = data.id || '';
    this.workflow = data.workflow ? JSON.parse(data.workflow) : false;
  }

  init(model) {
    // let a authentication service know it's url
    if( this.type === api.service.TYPES.AUTHENTICATION ) {
      request(
        this.url+'/_init',
        {
          headers : {
            [model.SIGNATURE_HEADER] : model.createServiceSignature(this.id)
          },
          qs : {
            servicePath: '/auth/'+this.id
          }
        },
        (error, response, body) => {
          // noop
        }
      );
    }
  }

  set frame(val) {
    if( val && typeof val === 'string' ) {
      val = JSON.parse(val);
    }
    this._frame = val;
  }

  get frame() {
    return this._frame;
  }

  set transform(val) {
    this._transform = val
  }

  get transform() {
    return this._transform;
  }

  /**
   * @method
   * 
   * @param {*} params 
   */
  renderUrlTemplate(params) {
    let url = this.urlTemplate;
    for( var key in params ) {
      url = url.replace(new RegExp(`{{${key}}}`, 'g'), params[key]);
    }
    return url.replace(/{{.*}}/g, '');
  }

}

module.exports = new ServiceModel();