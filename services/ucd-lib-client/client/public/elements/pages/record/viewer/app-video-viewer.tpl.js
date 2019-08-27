// https://github.com/ucd-library/pgdm-ui/tree/master/app/elements/pages/connect

import { html } from 'lit-element';
import plyrCss from "plyr/dist/plyr.css"
import shakaCss from "shaka-player/dist/controls.css"

export default function render() { 
return html`
    <style>
        :host {
            display: block;
            background: black;
        }

        .container {
            margin: 0 auto;
        }
        
        .plyr__video-wrapper {
            text-align: center;
        }

        button.plyr__control.plyr__control--overlaid {
            background: rgba(218,170,0,0.8);
        }

        button.plyr__control.plyr__control:hover {
            background: rgba(218,170,0,1.0);
        }

        ${plyrCss}
        ${shakaCss}
    </style>
    <div class="container" style="width: 500px;">
        <div id="sprite-plyr" style="display: none;"></div>
        <video id="player" playsinline controls crossorigin></video>
    </div>
    <app-image-viewer-lightbox id="lightbox"></app-image-viewer-lightbox>
    <app-image-viewer-nav on-zoom-in="_onZoomIn"></app-image-viewer-nav>
`
}
