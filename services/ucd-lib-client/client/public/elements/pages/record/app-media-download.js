import {PolymerElement} from "@polymer/polymer/polymer-element"
import template from "./app-media-download.html"

import MediaModel from "../../../lib/models/MediaModel"

import config from "../../../lib/config"
import utils from "../../../lib/utils"
// import bytes from "bytes"

// Full Resolution - Default
const SIZES = [
  {
    title : 'Small',
    label : 'S',
    ratio : 0.25
  },
  {
    title : 'Medium',
    label : 'M',
    ratio : 0.5
  },
  {
    title : 'Large',
    label : 'L',
    ratio : 0.75
  },
  {
    title : 'Full Resolution',
    label : 'FR',
    ratio : 1
  }
]

const FORMATS = ['png', 'jpg', 'webp'];

export default class AppMediaDownload extends PolymerElement {

  static get template() {
    let tag = document.createElement('template');
    tag.innerHTML = template;
    return tag;
  }

  static get properties() {
    return {
      href : {
        type : String,
        value : ''
      },
      resolution : {
        type : String,
        value : ''
      },
      size : {
        type : String,
        value : ''
      },
      resolutionTitle : {
        type : String,
        value : 'Full Resolution'
      },
      fileFormat : {
        type : String,
        value : ''
      },
      fileSize: {
        type: String,
        value: ''
      },
      mediaType : {
        type: String,
        value: ''
      },
      isVideo: {
        type: Boolean,
        value: false
      },
      sizes : {
        type : Array,
        value : () => []
      },
      formats : {
        type : Array,
        value : () => []
      },
      defaultImage : {
        type : Boolean,
        value : true
      },
      hasMultipleImages : {
        type : Boolean,
        value : false
      },
      multipleImagesSelected : {
        type : Boolean,
        value : false
      }
    }
  }

  /**
   * @method render
   * @description render download icon from given options
   * 
   * @param {Object} options render options
   * @param {Array} options.resolution image resolution
   * @param {String} options.size full resolution image size
   * @param {String} options.fileFormat default mime type
   * @param {String} options.url fedora image url
   */
  render(options) {
    this.options = options;
    this.sizes = SIZES.map((format, index) => {
      return {
        title : format.title,
        label : format.label,
        width: Math.floor(options.resolution[0] * format.ratio),
        height: Math.floor(options.resolution[1] * format.ratio),
        selected : (this.selectedSize === index)
      }
    });

    this.hasMultipleImages = (this.imagelist.length > 1);
    this.multipleImagesSelected = false;

    //this.size = bytes(options.size);  
    this.mediaType = options.fileFormat.substring(0, options.fileFormat.lastIndexOf('/')).toLowerCase();
    this.originalFormat = options.fileFormat.replace(/.*\//, '').toLowerCase();    
    
    this.$.format.value = this.originalFormat;
    this.defaultImage = true;

    this._renderFormats();    
  }

  setRootRecord(record, imagelist) {
    if( this.rootRecord === record ) return;

    this.rootRecord = record;
    this.imagelist = imagelist;
    this.hasMultipleImages = (this.imagelist.length > 0);
    this.multipleImagesSelected = false;

    this.selectedSize = SIZES.length - 1;

    this.fileSize = utils.formatBytes(this.rootRecord.size);
  }

  /**
   * @method _renderFormats
   * @private
   * @description render formats select element based of static format 
   * list and additional native format if not in list and size is at
   * full resolution.
   */
  _renderFormats() {
    let formats;

    formats = FORMATS.slice(0);
    if( this.originalFormat &&
        this.selectedSize === SIZES.length - 1 &&
        formats.indexOf(this.originalFormat) === -1 ) {
      formats.unshift(this.originalFormat);
    }

    this.formats = formats;

    this.$.format.innerHTML = '';
    this.formats.forEach(format => {
      let option = document.createElement('option');
      option.textContent = format + ((format === this.originalFormat) ? ' (native)' : '');
      option.value = format;

      /*
      if (format === this.originalFormat) {
        option.setAttribute('selected', 'selected');
      }
      */
      
      this.$.format.appendChild(option);
    });

    this._renderDownloadHref();
  }

  /**
   * @method _onSizeSelected
   * @private
   * @description called when user selects a size button.  Toggle over buttons
   * to off state and updates formats based on current size.
   */
  _onSizeChange(e) {
    let selected = e.currentTarget.value;

    this.sizes = this.sizes.map((size, index) => {
      if( selected === size.label ) {
        size.selected = true;
        this.selectedSize = index;
      } else {
        size.selected = false;
      }
      
      return Object.assign({}, size);
    });
    // this.resolutionTitle = this.sizes[this.selectedSize].title;

    this._renderFormats();
  }

  /**
   * @method _onFormatSelected
   * @private
   * @description when a format is selected, render the download button.
   */
  _onFormatSelected() {
    this.selectedFormat = this.$.format.value.replace(/ .*/, '');
    this._renderDownloadHref();
  }

  /**
   * @method _renderDownloadHref
   * @private
   * @description render the href of the download button based
   * and selected size and format.
   * 
   * This method will make sure the format select element is correct.
   * Because the select element options are generated by a template repeat
   * tag, we need to make sure then options have rendered.  So we call 
   * requestAnimationFrame to pause to allow time for generation.  This
   * is probably NOT the best way to do things.
   */
  _renderDownloadHref() {
    requestAnimationFrame(() => {
      // this.resolution = this.sizes[this.selectedSize].size.join(' x ')+' px';

      if( !this.selectedFormat || this.formats.indexOf(this.selectedFormat) === -1 ) {
        this.selectedFormat = this.formats[0].replace(/ .*/, '');
        this.$.format.value = this.formats[0];
      }
    
      if( this.$.format.value !== this.selectedFormat ) {
        this.$.format.value = this.selectedFormat;
      }

      this._setTarPaths();

      if( this.selectedFormat === this.originalFormat && 
        this.selectedSize === SIZES.length -1 ) {
          this.defaultImage = true;
          return this.href = this.options.url;
      }

      this.defaultImage = false;

      let size = this.sizes[this.selectedSize];
      size = size.width+','+size.height;

      this.href = this.options.url + `/svc:iiif/full/${size}/0/default.${this.selectedFormat}`;
    });
  }

  /**
   * @method _onDownloadClicked
   * @description bound to download button click event, record analytics
   */
  _onDownloadClicked() {
    let path = this.href.replace(config.fcrepoBasePath, '');
    gtag('event', 'download', {
      'event_category': 'image',
      'event_label': path,
      'value': 1
    });
  }

  /**
   * @method _toggleMultipleDownload
   * @description bound to radio buttons click event
   */
  _toggleMultipleDownload() {
    this.multipleImagesSelected = this.$.fullset.checked ? true : false;
  }

  _setTarPaths() {
    if( !SIZES[this.selectedSize] ) return;

    let origin = false;

    if( this.selectedFormat === this.originalFormat && this.selectedSize === SIZES.length -1 ) {
      origin = true;
    }

    let urls = {};
    this.imagelist.forEach(item => {
      let name = item.filename || item.name;
      if( origin ) {
        urls[name] = item['@id'];
      } else {
        let s = SIZES[this.selectedSize];
        name = name.replace(/\.[a-z]*$/, `_${s.label}_.${this.selectedFormat}`);
        let w = Math.floor(item.image.width * s.ratio);
        let h = Math.floor(item.image.height * s.ratio);
        urls[name] = MediaModel.getImgUrl(item['@id'], w, h, {format:this.selectedFormat}).replace(config.fcrepoBasePath, '');
      }
    });

    this.tarName = this.rootRecord.name.replace(/[^a-zA-Z0-9]/g, '');
    this.$.tarPaths.value = JSON.stringify(urls);
  }

  /**
   * @method _downloadTar
   * @description bound to download set button click event
   */
  _downloadTar() {
    this.$.downloadTar.submit();
  }

}

customElements.define('app-media-download', AppMediaDownload);