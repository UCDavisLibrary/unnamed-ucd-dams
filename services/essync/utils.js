const {config} = require('@ucd-lib/fin-node-utils');
const {URL} = require('url');

const REMOVE_ATTRS = ['contains', 'accessControl', '@context',
'hasPart', 'hasParent', 'linkHint', 'hasMessageDigest', 'hasFixityService'];
const fcrepoHostRe = new RegExp('^'+config.fcrepo.host);

async function cleanupData(data, indexer) {
  let context = extractContextRe(data);

  /**
   * Some custom FIN bits here...
   * TODO: figure out best stratedgy for this
   */
  // set a preview image...
  if( !data.previewImage && data.hasPart ) {
    if( Array.isArray(data.hasPart) && data.hasPart.length > 0 ) {
      data.previewImage = data.hasPart[0];
    } else {
      data.previewImage = data.hasPart;
    }

    // grab 16x16 base64 encoded thumbnail preview image
    let imgUrl = replaceInternalUrl(data.previewImage, 'http://server:3001')+'/svc:iiif/full/8,/0/default.png';
    let result = await indexer.request({
      type : 'GET',
      encoding : null,
      uri: imgUrl
    });
    data.previewImageTinyThumbnail = 'data:image/png;base64,'+new Buffer(result.body).toString('base64');
  }



  // set short ids
  data.shortId = getShortId(data['@id']);
  if( data.isPartOf ) {
    data.shortIdIsPartOf = getShortId(data.isPartOf); 
  }



  REMOVE_ATTRS.forEach(attr => {
    if( data[attr] ) delete data[attr];
  });

  // replace local fin urls, remove @id and @value rdf objects
  data = cleanAttributes(data, context, true);

  return data;
}

function getShortId(id) {
  return new URL(id.replace(/\/$/, '')).pathname.split('/').pop();
}

function cleanAttributes(obj, context, root) {
  if( !root ) {
    if( typeof obj === 'string' ) {
      return cleanStringValue(obj, context)
    }

    if( obj['@id'] ) return cleanStringValue(obj['@id'], context, true);
    if( obj['@value'] ) return cleanStringValue(obj['@value'], context);
  }

  for( var key in obj ) {
    if( typeof obj[key] === 'string' ) {
      obj[key] = cleanStringValue(obj[key], context);
    } else if( Array.isArray(obj[key]) ) {
      obj[key] = obj[key].map(item => cleanAttributes(item, context, false));
    } else {
      obj[key] = cleanAttributes(obj[key], context, false);
    }
  }

  return obj;
}

/**
 * @method cleanStringValue
 * @description replace values that have a ns with url.  Clean local urls with
 * actual dams url
 */
function cleanStringValue(value, context, debug) {
  for( var i = 0; i < context.length; i++ ) {
    if( value.match(context[i].re) ) {
      value = value.replace(context[i].re, context[i].link);
      break;
    }
  }

  return replaceInternalUrl(value);
}

function replaceInternalUrl(url, altUrl) {
  if( url.match(fcrepoHostRe) ) {
    return url.replace(fcrepoHostRe, altUrl || config.server.url);
  }
  return url;
}

/**
 * @method extractContextRe
 * @description extract the ns context and create a list of regular
 * expressions to check for ns in values in method cleanStringValue
 */
function extractContextRe(data) {
  let context = data['@context'] || {};
  let arr = [];
  
  for( var key in context ) {
    if( typeof context[key] === 'string' ) {
      arr.push({
        re : new RegExp(`^${key}:`),
        link : context[key]
      });
    } else {
      arr.push({
        re : new RegExp(`^${key}:`),
        link : context[key]['@id']
      });
    }
  }
  return arr;
}

function isBinary(types) {
  for( let i = 0; i < types.length; i++ ) {
    if( types[i].match(/Binary$/) ) {
      return true;
    }
  }
  return false;
}

function isCollection(types) {
  for( let i = 0; i < types.length; i++ ) {
    if( types[i].match(/Collection$/) ) {
      return true;
    }
  }
  return false;
}

function isDotPath(path) {
  if( path.match(/http/) ) {
    let urlInfo = new URL(path);
    path = urlInfo.pathname;
  }
  
  path = path.split('/');
  for( var i = 0; i < path.length; i++ ) {
    if( path[i].match(/^\./) ) {
      return true;
    }
  }
  
  return false;
}


module.exports = {
  cleanupData,
  isCollection,
  isDotPath,
  isBinary,
  replaceInternalUrl
}