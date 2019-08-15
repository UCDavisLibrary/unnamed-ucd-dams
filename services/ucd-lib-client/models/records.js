const es = require('../lib/esClient');
const config = require('../config');
const ElasticSearchModel = require('./elasticsearch');
const clone = require('clone');
const transform = require('../lib/seo-transform');

const FILL_ATTRIBUTES = config.elasticsearch.fields.fill;

class RecordsModel extends ElasticSearchModel {

  /**
   * @method get
   * @description get a record by id.  This method will walk 'hasPart'
   * and 'associatedMedia' array filling in child records.
   * 
   * @param {String} id record id
   * @param {Boolean} seo apply seo/schema.org transform.  This will provide json-ld
   * that can be validated against a schema.org parser.
   * 
   * @return {Promise} resolves to record
   */
  async get(id, seo=false) {
    let result = await this.esGet(id);
    await this._fillRecord(result._source, seo);
    if( seo ) transform(result._source);
    return result._source;
  }

  /**
   * @function getByArk
   * @description request record from elasticsearch with given
   * identifier (doi or ark)
   * 
   * @param {String} id doi or ark
   * 
   * @returns {Object|null}
   */
  async getByArk(id) {
    let result = await es.search({
      index: config.elasticsearch.record.alias,
      body : {
        query : {
          bool : {
            filter : [
              {term : {'identifier.raw' : id}},
              {term : {isRootRecord : true}}
            ]
          }
        }
      },
      _source_exclude : config.elasticsearch.fields.exclude,
    });

    // see if its a collection
    if( result.hits.total === 0 )  {
      result = await es.search({
        index : config.elasticsearch.collection.alias,
        body : {
          query : {
            bool : {
              filter : [
                {term : {'identifier.raw' : id}},
              ]
            }
          }
        },
        _source_exclude : config.elasticsearch.fields.exclude
      });
    }

    if( result.hits.total === 0 ) return null;
    return result.hits.hits[0]._source;
  }

  /**
   * @method _fillRecord
   * @description helper 'get' method for walking 'fill' attributes
   * 
   * @param {Object} record 
   * @param {Boolean} seo
   */
  async _fillRecord(record, seo) {
    for( var i = 0; i < FILL_ATTRIBUTES.length; i++ ) {
      if( !record[FILL_ATTRIBUTES[i]] ) continue;
      await this._fillAttribute(record, FILL_ATTRIBUTES[i], seo);
    }
  }
  
  /**
   * @method _fillAttribute
   * @description helper 'get' method for walking 'fill' attributes
   * 
   * @param {Object} record
   * @param {String} attribute
   * @param {Boolean} seo
   */
  async _fillAttribute(record, attribute, seo) {
    let values = record[attribute];
    if( !Array.isArray(values) ) values = [values];
    
    values = values.map(v => {
      if( typeof v === 'object' ) return v['@id'];
      return v;
    })

    // record['_'+attribute] = [];

    try {
      let resp = await this.esMget(values);
      record[attribute] = await resp.docs.map(doc => seo ? transform(doc._source) : doc._source);
    } catch(e) {
      // hummmm....
      record[attribute] = e.message;
    }
  
    for( var i = 0; i < record[attribute].length; i++ ) {
      let childRecord = record[attribute][i];
      if( !childRecord ) {
        record[attribute][i] = {error:true, message:'record not found'}
        continue;
      }
      await this._fillRecord(childRecord, seo);
    }
  }

  /**
   * @method search
   * @description search the elasticsearch records using the ucd dams
   * search document.  This will only search root records (records flagged
   * with isRootRecord).
   * 
   * @param {Object} SearchDocument
   * @param {Boolean} debug will return searchDocument and esBody in result
   * 
   * @returns {Promise} resolves to search result
   */
  async search(searchDocument = {}, debug = false) {
    // right now, only allow search on root records
    if( !searchDocument.filters ) {
      searchDocument.filters = {};
    }

    searchDocument.filters.isRootRecord = {
      type : 'keyword',
      op : 'and',
      value : [true]
    }

    let esBody = this.searchDocumentToEsBody(searchDocument);
    let esResult = await this.esSearch(esBody);
    let result = this.esResultToDamsResult(esResult, searchDocument);

    // now we need to fill on 'or' filters facets options
    // to get counts as the dams UI wants them, we need to perform a
    // agg only query with the 'or' bucket attributes removed
    let facets = searchDocument.facets || {};
    for( let filter in searchDocument.filters ) {
      // user don't care about this agg
      if( !facets[filter] ) continue; 
      // only need to worry about facet filters
      if( searchDocument.filters[filter].type !== 'keyword' ) continue; 
      // only need to worry about 'or' filters
      if( searchDocument.filters[filter].op !== 'or' ) continue; 

      let tmpSearchDoc = clone(searchDocument);
      // we don't need results
      tmpSearchDoc.offset = 0;
      tmpSearchDoc.limit = 0;
      // remove the filter
      delete tmpSearchDoc.filters[filter]
      // only ask for aggs on this filter
      tmpSearchDoc.facets = {
        [filter] : {
          type : 'facet'
        }
      }

      let tmpResult = await this.esSearch(this.searchDocumentToEsBody(tmpSearchDoc));
      tmpResult = this.esResultToDamsResult(tmpResult, tmpSearchDoc);

      // finally replace facets response
      result.aggregations.facets[filter] = tmpResult.aggregations.facets[filter];
    }

    if( debug ) {
      result.searchDocument = searchDocument;
      result.esBody = esBody;
    }

    return result;
  }

  /**
   * @method esSearch
   * @description search the elasticsearch records using
   * es search document
   * 
   * @param {Object} body elasticsearch search body
   * @param {Object} options elasticsearch main object for additional options
   * 
   * @returns {Promise} resolves to elasticsearch result
   */
  esSearch(body = {}, options={}) {
    options.index = config.elasticsearch.record.alias;
    options.body = body;

    options._sourceExclude = config.elasticsearch.fields.exclude;

    return es.search(options);
  }

  /**
   * @method esScroll
   * @description croll a search request (retrieve the next set of results) after specifying the scroll parameter in a search() call.
   * https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-scroll
   * 
   * @param {Object} options
   * @param {String} options.scrollId current scroll id
   * @param {String} options.scroll time to keep open
   * 
   * @returns {Promise} resolves to elasticsearch result
   */
  esScroll(options={}) {
    return es.scroll(options);
  }

  /**
   * @method esGet
   * @description get the elasticsearch record using record id
   * 
   * @param {String} id record id
   * 
   * @returns {Promise} resolves to elasticsearch result
   */
  esGet(id, debug=false) {
    let queryDoc = {
      index: config.elasticsearch.record.alias,
      type: '_all',
      id: id
    }

    if( !debug ) {
      queryDoc._sourceExclude = config.elasticsearch.fields.exclude;
    }

    return es.get(queryDoc);
  }

  /**
   * @method esMget
   * @description get the elasticsearch records using array of record ids
   * 
   * @param {Array} ids record ids
   * 
   * @returns {Promise} resolves to elasticsearch result
   */
  esMget(ids) {
    return es.mget({
      index: config.elasticsearch.record.alias,
      type: '_all',
      _sourceExclude : config.elasticsearch.fields.exclude,
      body: {ids}
    });
  }

  /**
   * @method rootCount
   * @description get count of all root records
   * 
   * @returns {Promise} resolves to {Number}
   */
  rootCount() {
    return es.count({
      index: config.elasticsearch.record.alias,
      body : {
        query : {
          bool : {
            filter : {
              term : {
                isRootRecord : true
              }
            }
          }
        }
      }
    });
  }

}

module.exports = new RecordsModel();