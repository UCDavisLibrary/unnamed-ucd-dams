import { LitElement } from "lit-element"
import render from "./app-media-viewer.tpl"

import "./app-image-viewer"
import "./app-360-image-viewer"
import "./app-video-viewer"

import "./app-image-viewer-nav"
import "./app-image-viewer-lightbox"

import "@ucd-lib/cork-app-utils"

export default class AppMediaViewer extends Mixin(LitElement)
  .with(LitCorkUtils) {

    static get properties() {
      return {
        isVideo: {
          type: Boolean,
          value: false
        }
      }
    }

    constructor() {
      super();
      this.render = render.bind(this);
      this._injectModel('AppStateModel');
      this.isVideo = false;
    }

    firstUpdated(e) {
      this.$.lightbox   = this.shadowRoot.getElementById('lightbox');
      this.$.navTop     = this.shadowRoot.getElementById('nav-top');
      this.$.navBottom  = this.shadowRoot.getElementById('nav-bottom');
      this.$.zoomButton = this.$.navBottom.shadowRoot.getElementById('zoomIn1');
      
      this.$.video = this.shadowRoot.getElementById('videoViewer');
      this.$.video.style.display = 'none';
      this.$.navTop.style.display = 'none';
    }

    updated(e) {
      this.$.zoomButton.addEventListener('click', (e) => {
        this._onZoomIn(e)
      });
    }

    async _onSelectedRecordMediaUpdate(record) {

      if (record.media && record.media.video) {
        this.isVideo = true;
        this.$.video.style.display = 'block';
        this.$.navTop.style.display = 'block';
        this.$.navBottom.style.display = 'none';
        //this.$.zoomButton.style.display = 'none';
        return;
      }
    }

    /**
     * @method _onZoomIn
     * @description bound to zoom event in app-image-viewer-nav. 
     * 
     * @param {Object} e custom HTML event
     */
    _onZoomIn(e) {
      this.$.lightbox.show();
    }
  }

  customElements.define('app-media-viewer', AppMediaViewer);