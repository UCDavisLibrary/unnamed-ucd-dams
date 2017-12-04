import {Element as PolymerElement} from "@polymer/polymer/polymer-element"
import moment from "moment"
import "./app-search-result-creator"
import CollectionInterface from "../../../interfaces/CollectionInterface"
import AppStateInterface from "../../../interfaces/AppStateInterface"

export default class AppSearchResult extends Mixin(PolymerElement)
  .with(EventInterface, AppStateInterface, CollectionInterface) {

  static get properties() {
    return {
      data : {
        type : Object,
        value : () => {},
        observer : '_onDataUpdate'
      },
      fetchId : {
        type : String,
        value : ''
      },
      isImage : {
        type : Boolean,
        value : false
      },
      imgUrl : {
        type : String,
        value : ''
      },
      collectionName : {
        type : String,
        value : ''
      },
      title : {
        type : String,
        value : ''
      },
      description : {
        type : String,
        value : ''
      },
      creator : {
        type : Array,
        value : () => []
      },
      year : {
        type : String,
        value : ''
      }
    }
  }

  constructor() {
    super();

    this.baseUrl = window.location.protocol+'//'+window.location.host+'/fcrepo/rest';
    this.momentFormat = 'YYYY';
  }

  ready() {
    super.ready();
    this.addEventListener('click', this._onClick);
  }

  /**
   * Fired when this element is clicked
   */
  _onClick() {
    this._setWindowLocation('/record'+this.fetchId);
  }

  _isImg(mimeType) {
    if( !mimeType ) return false;
    return mimeType.match(/^image/i) ? true : false;
  }

  _onDataUpdate() {
    let data = Object.assign({}, this.data);
    if( !data['@id'] ) return;
    
    this.fetchId = data['@id'].replace(this.baseUrl, '');   

    this.collectionName = this.data.memberOf || '';
    if( this.collectionName ) {
      this.collectionName = this._getCollection(this.collectionName).title;
    }

    this.title = this.data.title || '';

    if( this._isImg(this.data.hasMimeType) ) {
      if( this.data.imageResolution ) {
        let ratio = this.data.imageResolution[1] / this.data.imageResolution[0];
        this.imgHeight = Math.floor(250 * ratio);
        this.imgUrl = `${this.data['@id']}/svc:iiif/full/,${this.imgHeight+40}/0/default.png`;
      } else {
        this.imgHeight = 250;
        this.imgUrl = this.data['@id']+'/svc:iiif/full/,290/0/default.png';
      }

      
      this.isImage = true;
    } else {
      this.imgUrl = '';
      this.isImage = false;
    }

    this.description = this.data.description || '';
    if( this.description.length > 200 ) {
      this.description = this.description.substr(0, 200)+'...';
    }

    this.year = data.created ? moment(data.created).format(this.momentFormat) : '';

    if( Array.isArray(data.creator) ) {
      this.creator = data.creator;
    } else {
      this.creator = [data.creator || ''];
    }
  }

}