const {logger} = require('@ucd-lib/fin-node-utils');
const buffer = require('./buffer');
const config = require('./config');

class AttributeReducer {
  
  constructor(esClient) {
    this.esClient = esClient;
    buffer.on('record-update', (e) => this.reduceAttributes(e));
  }

  /**
   * @method onRecordUpdate
   * @description should be called whenever a record updates
   * 
   * @param {Object} e 
   * @param {Object|String} e.record the record (container) that was updated
   * @param {String} e.alias alias to add record to
   */
  async onRecordUpdate(e) {
    if( typeof e.record === 'string' ) {
      let exists = await this._exists(e.record, e.alias);
      if( !exists ) return;
      e.record = await this._get(e.record, e.alias);
    }

    if( e.record.isRootRecord ) {
      return buffer.add({id: e.record.id, alias: e.alias});
    }

    let rootRecordPath = await this.findRootRecord(e.record.id, e.alias);
    if( rootRecordPath ) buffer.add({id: rootRecordPath, alias: e.alias});
  }

  /**
   * @method findRootRecord
   * @description given a path, walk the isPartOf and encodesCreativeWork links
   * to find the parent container that is marked with isRootRecord (if it exists).
   * Either a id string or null is returned if the root record cannot be found.
   * 
   * @param {String} path record id
   * @param {String} alias (optional) index alias to use
   * 
   * @returns {Promise} resolves to String or null 
   */
  async findRootRecord(path, alias) {
    let exists = await this._exists(path, alias);
    if( !exists ) return null;

    let record = await this._get(path, alias);

    if( record.isRootRecord ) {
      return record.id;
    }

    let parentConnections = config.essync.parentConnections;
    for( let i = 0; i < parentConnections.length; i++ ) {
      if( record[parentConnections[i]] ) {
        return await this.findRootRecord(record[parentConnections[i]], alias);
      }
    }

    return null;
  }

  /**
   * @method reduceAttributes
   * @description walk the entire tree of hasParts and associatedMedia
   * adding reducing properties as you go.  id should be a root record
   * 
   * @param {Object} e event
   * @param {String} e.id root record id 
   * @param {String} e.alias alias to add record to
   */
  async reduceAttributes(e) {
    let exists = await this._exists(e.id, e.alias);
    if( !exists ) return;

    let record = await this._get(e.id, e.alias);
    if( !record.isRootRecord ) return;

    let reduced = {};
    await this.walkRecord(record, reduced, e.alias);
    
    for( let key in reduced ) {
      record[key] = reduced[key];
    }

    let index = e.alias || config.elasticsearch.record.alias;
    logger.info('Setting reduced attributes', e.id, index, reduced);

    await this.esClient.index({
      index : index,
      type: config.elasticsearch.record.schemaType,
      id : record.id,
      body: record
    });
  }

  /**
   * @method walkRecord
   * @description recursively walk to the associatedMedia and parts adding
   * reduced attributes as you go
   * 
   * @param {String|Object} record either record object or record id string
   * @param {Object} reduced current reduced attribute state
   * @param {String} alias (optional) index alias to use
   * 
   * @returns {Promise} 
   */
  async walkRecord(record, reduced, alias) {
    if( typeof record === 'string' ) {
      let exists = await this._exists(record, alias);
      if( !exists ) return;
      record = await this._get(record, alias);
    }

    this.addAttributes(record, reduced);

    let childConnections = config.essync.childConnections;
    for( let i = 0; i < childConnections.length; i++ ) {
      if( !record[childConnections[i]] ) continue;
      
      let values = Array.isArray(record[childConnections[i]]) ? record[childConnections[i]] : [record[childConnections[i]]];
      
      for( let j = 0; j < values.length; j++ ) {
        await this.walkRecord(values[j], reduced, alias);
      }
    }
  }
  

  /**
   * @method addAttributes
   * @description given a record and the reduced attributes hash,
   * add the given records attributes to the reduced has
   * 
   * @param {Object} record 
   * @param {Object} reduced
   * 
   * @returns {Object} 
   */
  addAttributes(record, reduced = {}) {
    for( var key in config.essync.reduceAttributes ) {
      if( !record[key] ) continue;

      let values = record[key];
      if( !Array.isArray(values) ) values = [values];
      
      let rkey = config.essync.reduceAttributes[key];
      if( !reduced[rkey] ) {
        reduced[rkey] = values;
        continue;
      }

      values.forEach(val => {
        if( reduced[rkey].indexOf(val) > -1 ) return;
        reduced[rkey].push(val);
      });
    }

    // reduce @type to type for schema.org attributes
    if( !reduced.type ) reduced.type = [];
    (record['@type'] || []).forEach(val => {
      if( !val.match(/^schema:/) ) return;
      val = val.replace(/^schema:/, '');
      if( reduced.type.indexOf(val) > -1 ) return;
      reduced.type.push(val);
    });

    return reduced;
  }

  _exists(id, alias) {
    return this.esClient.exists({
      index : alias || config.elasticsearch.record.alias,
      type: config.elasticsearch.record.schemaType,
      id : id
    });
  }

  async _get(id, alias) {
    let record = await this.esClient.get({
      index: alias || config.elasticsearch.record.alias,
      type: config.elasticsearch.record.schemaType,
      id: id
    });
    return record._source;
  }

}

module.exports = AttributeReducer;