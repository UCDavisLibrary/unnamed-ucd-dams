import {Element as PolymerElement} from "@polymer/polymer/polymer-element"
import "@ucd-lib/cork-pagination"

import "./app-search-grid-result"
import "./app-search-list-result"
import ElasticSearchInterface from "../../../interfaces/ElasticSearchInterface"
import AppStateInterface from "../../../interfaces/AppStateInterface"

import template from './app-search-results-panel.html'

class AppSearchResultsPanel extends Mixin(PolymerElement)
      .with(EventInterface, ElasticSearchInterface, AppStateInterface) {

  static get properties() {
    return {
      /**
       * Array of search results
       */
      results : {
        type : Array,
        value : () => []
      },
      /**
       * size in px's between each masonary layout cell
       */
      masonryMargin : {
        type : Number,
        value : 15
      },
      /**
       * are we in list or masonry layout
       */
      isListLayout : {
        type : Boolean,
        value : false
      },
      /**
       * UI display of total results
       */
      total : {
        type : Number,
        value : 0
      },

      numPerPage : {
        type : Number,
        value : 1
      },
      
      currentIndex : {
        type : Number,
        value : 0
      }
    }
  }

  static get template() {
    return template;
  }

  constructor() {
    super();
    this.active = true;

    this.resizeTimer = -1;
    window.addEventListener('resize', () => this._resizeAsync());
  }

  _onAppStateUpdate(e) {
    if( e.location.path[0] !== 'search') return;
    this._resizeAsync();
  }

  loading() {

  }

  /**
   * @method render
   * @description render results of search query
   * 
   * @param {Array} results results to render
   */
  render(results, total, numPerPage, currentIndex) {
    this.results = results;
    this.total = total;
    this.numPerPage = numPerPage;
    this.$.numPerPage.value = numPerPage;
    this.currentIndex = currentIndex;

    requestAnimationFrame(() => this._resize());
  }

  /**
   * @method _onLayoutToggle
   * @description Toggle between masonry and list layout
   * 
   * @param {Event} e HTML click event
   */
  _onLayoutToggle(e) {
    let type = e.currentTarget.getAttribute('type');
    if( type === 'masonry' ) this.isListLayout = false;
    else this.isListLayout = true;

    if( !this.isListLayout ) {
      requestAnimationFrame(() => this._resize());
    }
  }

  /**
   * @method _resizeAsync
   * @description buffer resize masonary layout call
   */
  _resizeAsync() {
    if( this.resizeTimer !== -1 ) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = -1;
      this._resize();
    }, 50);
  }

  /**
   * @method _resize
   * @description resize masonary layout
   */
  _resize() {
    if( this.isListLayout ) return;

    let firstDiv = this.$.layout.querySelector('app-search-grid-result');
    if( !firstDiv ) return;

    let ew = this.offsetWidth;
    let w = firstDiv.offsetWidth + this.masonryMargin;

    let numCols = Math.max(Math.floor(ew / w), 1);
    // this makes sure columns are centered
    let leftOffset = Math.floor((ew - numCols * w) / 2);

    let colHeights = [];
    for( var i = 0; i < numCols; i++ ) colHeights.push(0);

    let eles = this.$.layout.querySelectorAll('app-search-grid-result');
    for( let i = 0; i < eles.length; i++ ) {
      let col = this._findMinCol(colHeights);
      let cheight = colHeights[col];

      eles[i].style.left = (leftOffset + col * w) + 'px';
      eles[i].style.top = colHeights[col] + 'px';
      eles[i].style.visibility = 'visible';

      colHeights[col] += eles[i].offsetHeight + this.masonryMargin;
    }

    let maxHeight = Math.max.apply(Math, colHeights);
    this.$.layout.style.height = maxHeight+'px';
  }

  /**
   * @method _findMinCol
   * @description given an array of column heights, return
   * the column index that has the min height
   * 
   * @param {Array} colHeights array of heights
   */
  _findMinCol(colHeights) {
    let min = colHeights[0];
    let minCol = 0;
    for( var i = 1; i < colHeights.length; i++ ) {
      if( min > colHeights[i] ) {
        min = colHeights[i];
        minCol = i;
      }
    }
    return minCol;
  }

  /**
   * @method _onToggleDrawer
   * @description fire an event for app-search indicating the drawer toggle has
   * been clicked.
   */
  _onToggleDrawer() {
    this.dispatchEvent(new CustomEvent('toggle-drawer'));
  }

  _onPageSizeChange() {
    this.dispatchEvent(new CustomEvent('page-size-change', {
      detail : parseInt(this.$.numPerPage.value)
    }));
  }

  _onPaginationNav(e) {
    this.dispatchEvent(new CustomEvent('page-change', {
      detail : e.detail
    }));
  }

}

customElements.define('app-search-results-panel', AppSearchResultsPanel);