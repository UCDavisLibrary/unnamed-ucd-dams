const {BaseModel} = require('@ucd-lib/cork-app-utils');
const CollectionStore = require('../stores/CollectionStore');
const CollectionService = require('../services/CollectionService');
// it's ok to import other stores & services, just not models
const ElasticSearchStore = require('../stores/ElasticSearchStore');

class CollectionModel extends BaseModel {
  
    constructor() {
      super();
      this.store = CollectionStore;
      this.service = CollectionService;

      // the selected collection functionality is just a shortcut for listening
      // to es filters and seeing if a collection is being filtered on. This is
      // where we wire up the event listener for es events.
      this.MasterController.on(
        ElasticSearchStore.events.SEARCH_DOCUMENT_UPDATE, 
        this._onSearchDocumentUpdate.bind(this)
      );

      this.register('CollectionModel');
    }

    overview() {
      return this.service.overview();
    }

    /**
     * @method get
     * @description get a collection by id
     * 
     * @param {String} id id of the collection
     */
    get(id) {
      return this.store.data.byId[id];
    }

    /**
     * @method getByShortId
     * @description get a collection by short id
     * 
     * @param {String} shortId shortId of the collection
     */
    getByShortId(shortId) {
      return this.store.data.byShortId[shortId];
    }

    /**
     * @method getSelectedCollection
     * @description get the selected collection
     */
    getSelectedCollection() {
      return this.store.data.selected;
    }

    /**
     * @method _onSearchDocumentUpdate
     * @description listen to search document updates, if we have a shortIdMemberOf filter,
     * then there is a selected collection
     */
    _onSearchDocumentUpdate(e) {
      let selected = null;
      if( e.filters.shortIdMemberOf ) {
        selected = this.getByShortId(e.filters.shortIdMemberOf.value[0]);
      }
      this.store.setSelectedCollection(selected);
    }
}

module.exports = new CollectionModel();