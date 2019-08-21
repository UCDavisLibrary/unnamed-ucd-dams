
class Utils {

  getYearFromDate(date) {
    if( !date ) return '';
    date = date+'';

    date = date.match(/^(\d{4})/);
    if( !date ) return '';
    return date[0];
  }

  /**
   * @method asArray
   * @description given a record object, return a key as an array.
   * If the key doesn't exist, the array will be empty.  Singletons will
   * be converted to single item arrays and keys that are already arrays
   * will be return as is.
   * 
   * @param {Object} item most likely a JSON-LD record
   * @param {String} key key/attribute to access in item/record
   * 
   * @return {Array}
   */
  asArray(item = {}, key) {
    let value = item[key] || [];
    return Array.isArray(value) ? value : [value];
  }

  /**
   * @method formatBytes
   * @description return bytes as the appropriate data size (Bytes, KB, MB, etc)
   * 
   * @param {Object} bytes - a number
   * 
   * @return {String}
   */
  // https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + '\xa0' + sizes[i];
  }

  isVideo(object){
    return object['type'].includes("Video");
  }

  formatVideo(object) {
    let videoObj, mpdObj, vidId, sources;

    if (object.associatedMedia) {
       sources = object.associatedMedia.filter((element) => {
        if (element.video) return element;
      }).map((element) => {
        let obj = {
          src: element.video['@id'],
          type: element.encodingFormat,
          size: parseInt(element.videoQuality)
        }

        return obj;
      });
    }

    if (!object.associatedMedia) {
      mpdObj = object;
      vidId  = mpdObj.video['@id'];
    } else {
      let hasPartObj = object.associatedMedia.find((element) => {
        if (element['hasPart']) return element;
      });

      if (!hasPartObj) {
        mpdObj = object.associatedMedia[0];
        vidId = mpdObj['video']['@id'];
      } else {
        mpdObj = hasPartObj['hasPart'].find((element) => {
          if (element['encodingFormat'] === "application/dash+xml") return element;
        });

        vidId = mpdObj['@id'];
      }
    }

    videoObj = {
      id: vidId,
      name: mpdObj['name'],
      poster: mpdObj['thumbnailUrl'],
      encodingFormat: mpdObj['encodingFormat'],
      videoQuality: mpdObj['videoQuality'],
      sources: sources
    }

    return videoObj;
  }

}

module.exports = new Utils();