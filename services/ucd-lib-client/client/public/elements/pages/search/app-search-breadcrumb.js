import {PolymerElement} from "@polymer/polymer/polymer-element"
import CollectionInterface from "../../interfaces/CollectionInterface"
import RecordInterface from "../../interfaces/RecordInterface"
import AppStateInterface from "../../interfaces/AppStateInterface"
import template from "./app-search-breadcrumb.html"

class AppSearchBreadcrumb extends Mixin(PolymerElement)
        .with(EventInterface, AppStateInterface, CollectionInterface, RecordInterface) {

  static get properties() {
    return {
      collection : {
        type : Object,
        value : null
      },
      record : {
        type : Object,
        value : null
      },
      name : {
        type : String,
        value : ''
      }
    }
  }

  static get template() {
    let tag = document.createElement('template');
    tag.innerHTML = template;
    return tag;
  }

  constructor() {
    super();
    this.active = true;
  }

  async ready() {
    super.ready();
    this.$.layout.style.width = (window.innerWidth-55)+'px';
    window.addEventListener('resize', () => {
      this.$.layout.style.width = (window.innerWidth-55)+'px';
    });

    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  /**
   * @method _onAppStateUpdate
   * @description listen to app state update events and if this is a record, set record collection
   * as the current collection
   */
  async _onAppStateUpdate(e) {
    if( e.lastLocation && e.lastLocation.page === 'search' ) {
      this.lastSearch = e.lastLocation.pathname;
    } else {
      this.lastSearch = null;
    }

    if( e.location.page !== 'record' ) return;
    this.currentRecordId = e.location.pathname;

    this.record = await this._getRecord(this.currentRecordId);
    this.record = this.record.payload;

    if( this.record.collectionId ) {
      this.collection = await this._getCollection(this.record.collectionId);
    } else {
      this.collection = null;
    }
  }

  /**
   * @method _onSearchClicked
   * @description bound to search anchor tag click event.  nav to search
   */
  // _onSearchClicked(e) {
  //   if( e.type === 'keyup' && e.which !== 13 ) return;
  //   this._setWindowLocation(this.lastSearch || '/search');
  // }

  /**
   * @method _onCollectionClicked
   * @description bound to collection anchor tag click event.  start a collection query
   */
  _onCollectionClicked(e) {
    if( e.type === 'keyup' && e.which !== 13 ) return;
    this._setWindowLocation(this.lastSearch || (this.collection ? this.collection['@id'] : '/search'));
  }

  /**
   * @method _onSelectedCollectionUpdate
   * @description CollectionInterface, fired when selected collection updates
   */
  _onSelectedCollectionUpdate(e) {
    if( !e ) {
      if( !this.record ) {
        this.collection = null;
      }
      return;
    }

    if( this.collection && this.collection['@id'] === e['@id'] ) return;
    this.collection = e;
    this.record = null;
  }

}
customElements.define('app-search-breadcrumb', AppSearchBreadcrumb);