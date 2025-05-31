/*jshint esversion: 6, asi: true */
import BrowserWindow from 'sketch-module-web-view'
import { getWebview } from 'sketch-module-web-view/remote'
const sketch = require('sketch/dom');
const UI = require('sketch/ui');


var devName = 'sumUX';
var toolName = 'AEUX';
var docUrl = 'https://aeux.io/';
var versionNumber = 0.78;
var document, selection, folderPath, imageList = [], aveName, layerCount, aeSharePath, flatten, hasArtboard, exportCanceled, imagePath;


const webviewIdentifier = 'aeux.webview'
let existingWebview = null

export default function () {
    existingWebview = getWebview(webviewIdentifier)
    let theme = UI.getTheme()
    let darkMode = (theme === 'dark')

    const options = {
        identifier: webviewIdentifier,
        width: 158,
        height: 212,
        titleBarStyle: 'hiddenInset',
        remembersWindowFrame: true,
        // hidesOnDeactivate: false,
        resizable: false,
        // movable: false,
        // minimizable: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
            devTools: true,
        }
    }

    const browserWindow = new BrowserWindow(options)

    if (existingWebview) {
        existingWebview.webContents.executeJavaScript(`flashUI(${darkMode})`)
    } else {
        // load url
        browserWindow.loadURL(require('../resources/webview.html'))
    }

    // only show the window when the page has loaded to avoid a white flash
    browserWindow.once('ready-to-show', () => {
        browserWindow.show()
    })
    
    
    const webContents = browserWindow.webContents;

    // print a message when the page loads
    webContents.on('did-finish-load', () => {
        // UI.message('UI loaded!')
    })

    // add a handler for a call from web content's javascript
    webContents.on('nativeLog', s => {
        UI.message(s)
        webContents
        .executeJavaScript(`setRandomNumber(${Math.random()})`)
        .catch(console.error)
    })


    // open a link
    webContents.on('externalLinkClicked', url => {
        NSWorkspace.sharedWorkspace().openURL(NSURL.URLWithString(url))
    })
    // send layer data to Ae
    webContents.on('fetchAEUX', (prefs) => {
        // UI.alert('prefs', 'got some')
        fetchAEUX()
    })
    // send layer data to Ae
    webContents.on('detachSymbols', () => {
        detachSymbols()
    })
    // send layer data to Ae
    webContents.on('flattenCompounds', () => {
        flattenCompounds()
    })
    // Used to debug
    webContents.on('alert', (str) => {
        UI.alert('Debug:', str)
    })


    // set darkmode on launch
    webContents.executeJavaScript(`setDarkMode(${darkMode})`)

    // panel prefs
    var Settings = require('sketch/settings')
    var aeuxPrefs = Settings.settingForKey('aeuxPrefs')
    webContents.executeJavaScript(`setPrefs(${aeuxPrefs})`)

    webContents.on('setPrefs', (prefs) => {
        Settings.setSettingForKey('aeuxPrefs', prefs)
    })
}

// When the plugin is shutdown by Sketch (for example when the user disable the plugin)
// we need to close the webview if it's open
export function onShutdown() {
    existingWebview = getWebview(webviewIdentifier)
    if (existingWebview) {
        existingWebview.close()
    }
}

export function fetchAEUX () {
    let existingWebview = getWebview(webviewIdentifier)
    imageList = []
    
    document = require('sketch/dom').getSelectedDocument();
    selection = document.selectedLayers;

    /// reset vars
    // folderPath = null;
    hasArtboard = false;
    layerCount = 0;

    var aeuxData = filterTypes(selection);
    // FIXME: <rodionov> this layerCount counter is silly as it doesn't count what you think it does
    if (layerCount < 0 ) {
        existingWebview.webContents.executeJavaScript(`setFooterMsg('0 layers sent to Ae')`)
        return 
    }
    aeuxData[0].layerCount = layerCount;
    // aeuxData[0].folderPath = 6olderPath;

    console.log(aeuxData);

    if (imageList.length < 1) {
        fetch(`http://127.0.0.1:7240/evalScript`, {
        method: "POST",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                method: 'buildLayers',
                data: {layerData: aeuxData},
                switch: 'aftereffects',
                getPrefs: true,
            })
        })
        .then(response => {
            if (response.ok) {
                return response.json()
            } else {
                throw Error('failed to connect')
            }
        })
        .then(json => {
            // get back a message from Ae and display it at the bottom of Sketch
            console.log(json)
            let lyrs = json.layerCount        
            let msg = (lyrs == 1) ? lyrs + ' layer sent to Ae' : lyrs + ' layers sent to Ae'
            
            if (!existingWebview) {     // webview is closed
                UI.message(msg)
            } else {
                // send something to the webview
                existingWebview.webContents.executeJavaScript(`setFooterMsg('${msg}')`)
            }
        })
        .catch(e => {
            console.error(e)
            let msgToWebview = 'Unable to communicate with Ae'
            if (!existingWebview) {     // webview is closed
                UI.message(msgToWebview)
            } else {
                // send something to the webview            
                existingWebview.webContents.executeJavaScript(`setFooterMsg('${msgToWebview}')`)
            }
        });
    } else {        // save images
        console.log('Build images');
        console.log(aeuxData);
        
        fetch(`http://127.0.0.1:7240/writeFiles`, {
        method: "POST",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                switch: 'aftereffects',
                images: imageList,
                // path: imagePath, 
                data: { layerData: aeuxData }
            })
        })
        .then(response => {
            if (response.ok) {
                return response.json()
            } else {
                throw Error('failed to connect')
            }
        })
        .then(json => {
            // get back a message from Ae and display it at the bottom of Sketch
            console.log(json)
            let lyrs = json.layerCount        
            let msg = (lyrs == 1) ? lyrs + ' layer sent to Ae' : lyrs + ' layers sent to Ae'
            
            if (!existingWebview) {     // webview is closed
                UI.message(msg)
            } else {
                // send something to the webview
                existingWebview.webContents.executeJavaScript(`setFooterMsg('${msg}')`)
            }
        })
        .catch(e => {
            let msgToWebview = 'Unable to communicate with Ae'
            if (!existingWebview) {     // webview is closed
                UI.message(msgToWebview)
            } else {
                // send something to the webview            
                existingWebview.webContents.executeJavaScript(`setFooterMsg('${msgToWebview}')`)
            }
        })
    }
}

//// recursivly detach symbols from masters
export function detachSymbols() {
    
    document = require('sketch/dom').getSelectedDocument();
    selection = document.selectedLayers;

    // reset vars
    layerCount = 0;
    var layers = selection.layers;

    /// if an artboard is selected, process all layers inside of it
    if ( layers.length > 0 && (layers[0].type == 'Artboard' || layers[0].type == 'SymbolMaster')) {
        layers = layers[0].layers;
    }

    function detachAllSymbolInstancesAmongLayers(layers) {
        layers.forEach(layer => {
            if (layer.type === sketch.Types.SymbolInstance) {
                layer.detach({ recursively: true });
                layerCount++;
            }
            else if (layer.type === sketch.Types.Group || layer.type === sketch.Types.Artboard) {
                detachAllSymbolInstancesAmongLayers(sketch.find("SymbolInstance", layer) ?? []);
            }
        });
    }

    detachAllSymbolInstancesAmongLayers(layers);

    /// completion message
    let existingWebview = getWebview(webviewIdentifier)
    let lyrs = layerCount        
    let msg = (lyrs == 1) ? (lyrs + '+ symbol detached') : (lyrs + '+ symbols detached')
    if (!existingWebview) {     // webview is closed
        UI.message(msg)
    } else {
        existingWebview.webContents.executeJavaScript(`setFooterMsg('${msg}')`)
    }
}

//// simplify complex layers by recursivly flattening compound shapes
export function flattenCompounds() {
    document = require('sketch/dom').getSelectedDocument();
    selection = document.selectedLayers;

    /// reset vars
    layerCount = 0;
    var layers = selection.layers;

    /// if an artboard is selected, process all layers inside of it
    if ( layers.length > 0 && (layers[0].type == 'Artboard' || layers[0].type == 'SymbolMaster')) {
        layers = layers[0].layers;
    }

    function flattenAllShapesAmongLayers(layers) {
        layers.forEach(layer => {
            if (layer.type === sketch.Types.Shape) {
                // FIXME: <rodionovd> This should be possible to do via JS API
                layer.sketchObject.flatten();
                layerCount++;
            }
            else if (layer.type === sketch.Types.Group || layer.type === sketch.Types.Artboard) {
                detachAllSymbolInstancesAmongLayers(sketch.find("Shape", layer) ?? []);
            }
        });
    }

    flattenAllShapesAmongLayers(layers);

    /// completion message
    let existingWebview = getWebview(webviewIdentifier)
    let lyrs = layerCount        
    let msg = (lyrs == 1) ? lyrs + ' shape flattened' : lyrs + ' shapes flattened'
    if (!existingWebview) {     // webview is closed
        UI.message(msg)
    } else {
        existingWebview.webContents.executeJavaScript(`setFooterMsg('${msg}')`)
    }
}

//// get all selected layer data
function filterTypes(selection) {
	if (selection.length < 1) { return [{layerCount: 0}] }
    /// reset vars
    var selectedLayerInfo = [];
    var layers = selection.layers;
    var imageList = [];

    /// get artboard data
    if (!hasArtboard) { selectedLayerInfo.push( storeArtboard() ); }
    if (!hasArtboard) { layerCount = -2; return; }

    /// if an artboard is selected, process all layers inside of it
    if ( layers.length > 0 && (layers[0].type == sketch.Types.Artboard || layers[0].type == sketch.Types.SymbolMaster)) {
        layers = layers[0].layers;
    }

    /// check that the image export has not been canceled
    if (layerCount != -1) {
        /// loop through all selected layers
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            // skip layer if not visible
            if (layer.hidden) { continue; }

            // get layer data by layer type
            if ( layer.type == sketch.Types.Group ) {
                selectedLayerInfo.push( getGroup(layer) );
                continue;
            }
            if ( layer.type == sketch.Types.ShapePath || layer.type == sketch.Types.Shape ) {
                selectedLayerInfo.push( getShape(layer) );
            }
            if ( layer.type == sketch.Types.SymbolInstance ) {
                selectedLayerInfo.push( getSymbol(layer) );
            }
            if ( layer.type == sketch.Types.Text ) {
                selectedLayerInfo.push( getText(layer) );
            }
            if ( layer.type == sketch.Types.Image ) {
                var imgLayer = getImage(layer);
                if (imgLayer == null) { layerCount = -1; return selectedLayerInfo; }
                selectedLayerInfo.push( imgLayer );
            }

            // increment var to show on panels
            layerCount++;
        }
    }

    return selectedLayerInfo;
}


//// get artboard data
function storeArtboard() {
	var artboard = selection.layers[0].getParentArtboard() || selection.layers[0] || null;
    /// no artboard so store generic
	if (artboard === null) {
        return {}
    }

	var bgColor = [1,1,1,1];

	try {
		if (artboard.background.enabled) {
			bgColor = hexToArray(artboard.background.color);
		}
	} catch (e) {

	}

    var artboardObj = {
        type: 'Artboard',
        aeuxVersion: versionNumber,
        hostApp: 'Sketch',
        name: artboard.name,
        bgColor: bgColor,
        size: [artboard.frame.width, artboard.frame.height]
    };
    /// tells filterTypes() this doesn't need to run again
    hasArtboard = true;

    return artboardObj;
}


//// get layer data: SHAPE
function getShape(layer) {
    var layerType = getShapeType(layer);
	var layerData =  {
        type: layerType,
        name: layer.name,
        id: layer.id,
        frame: getFrame(layer),
        fill: getFills(layer),
        stroke: getStrokes(layer),
        shadow: getShadows(layer),
        innerShadow: getInnerShadows(layer),
        isVisible: !layer.hidden,
        path: getPath(layer, layer.frame),
        roundness: getRoundness(layer),
        blur: getBlur(layer),
        opacity: getOpacity(layer),
        rotation: -layer.transform.rotation,
        flip: getFlipMultiplier(layer),
        blendMode: getAELayerBlending(layer.style.blendingMode),
        // FIXME: <rodionovd>
        hasClippingMask: layer.sketchObject.hasClippingMask(),
        shouldBreakMaskChain: layer.sketchObject.shouldBreakMaskChain(),
    };

    /// if fill is an image and should return that instead of a shape
    if (layerData.fill != null && layerData.fill.type == 'Image') {
        // layerData = layerData.fill
        // return layerData.fill;

        var imageLayer = layerData.fill
            imageLayer.hasClippingMask = true
            // imageLayer.frame.x -= layerData.frame.x
            imageLayer.frame.x = layerData.frame.width / 2
            imageLayer.frame.y = layerData.frame.height / 2

            layerData.fill = [{
                type: 'fill',
                enabled: true,
                color: [0.5, 0.5, 0.5, 1],
                opacity: 100,
                blendMode: 1,
            }]
            layerData.frame.x = layerData.frame.width / 2
            layerData.frame.y = layerData.frame.height / 2
            layerData.hasClippingMask = true

        var groupData = {
            type: 'Component',
            name: '\u25BD ' + layer.name,
            id: layer.id,
            frame: getFrame(layer),
            isVisible: !layer.hidden,
            opacity: getOpacity(layer),
            shadow: getShadows(layer),
            innerShadow: getInnerShadows(layer),
            rotation: -layer.transform.rotation,
            blendMode: getAELayerBlending(layer.style.blendingMode),
            flip: getFlipMultiplier(layer),
            // layers: [],
            layers: [layerData, imageLayer],
            // FIXME: <rodionovd>
            hasClippingMask: layer.sketchObject.hasClippingMask(),
            shouldBreakMaskChain: layer.sketchObject.shouldBreakMaskChain(),
        }
        layerData = groupData
    }

    /// if shape is a compound get the shapes that make up the compound
    if (layerType == 'CompoundShape') {
        layerData.layers = getCompoundShapes(layer.layers);
        // FIXME: <rodionovd>
        layerData.booleanOperation = layer.layers[0].sketchObject.booleanOperation();
    }

  return layerData;																// output a string of the collected data

  /// get corner roundness clamped to the shape size
    function getRoundness(layer) {
        if (layer.type !== sketch.ShapePath) {
            return null;
        }

        var radius = layer.points[0].cornerRadius;
        var width = layer.frame.width;
        var height = layer.frame.height;
        var maxRad = Math.min(Math.min(width, height), radius);
        return maxRad;
    }
}


//// get layer data: SYMBOL
function getSymbol(layer) {
    // check if the symbol is an image override
    // if (layer.overrides.length > 0 &&
    //     layer.overrides[0].property == 'image' &&
    //     !layer.overrides[0].isDefault) {
    //     var imageLayer = getImage(layer);
    //     return imageLayer;
    // }

	if (layer.master == null) { return {}; }		// skip if layer missing

	var layerData =  {
        type: 'Symbol',
        name: layer.master.name,
        masterId: layer.master.id,
        id: layer.id,
        frame: getFrame(layer),
        style: layer.style,
        isVisible: !layer.hidden,
        opacity: getOpacity(layer),
        shadow: getShadows(layer),
        innerShadow: getInnerShadows(layer),
        blendMode: getAELayerBlending(layer.style.blendingMode),
        layers: filterTypes(layer.master),
        symbolFrame: layer.master.frame,
        bgColor: hexToArray(layer.master.background.color),
        rotation: -layer.transform.rotation,
        flip: getFlipMultiplier(layer),
        // FIXME: <rodionovd>
        hasClippingMask: layer.sketchObject.hasClippingMask(),
        shouldBreakMaskChain: layer.sketchObject.shouldBreakMaskChain(),
	};
    getOverrides(layer, layerData);
    return layerData;


    /// get text and nested symbol overrides
    function getOverrides(layer, symbolObj) {
        // reset vars
        var overrideList = [];
        var overrides = layer.overrides;

        // loop through each override on the layer
        for (var i = 0; i < overrides.length; i++) {
            var override = overrides[i];
            if (!override.isDefault) {              // has an override
                symbolObj.id = 'override';
                symbolObj.masterId = 'override';

                // DEPRECIATED forced symbol detach
                // if (override.property == 'image') {     // needs to be detatched from master
                //     var detatchedGroup = layer.detach();
                //     overrideList = [];                  // reset the list
                //     i = 0;                              // reset the count
                // }

                // loop through all layers in the symbol
                for (var j = 0; j < symbolObj.layers.length; j++) {
                    var currentLayer = symbolObj.layers[j];
                    //// it is a GROUP ////    recurse deeper
                    if (currentLayer.type == 'Group') {
                        getOverrides(layer, currentLayer);
                        continue;
                    }
                    //// it is a SYMBOL ////
                    if (override.symbolOverride) {
                        if (currentLayer.id == override.path) {      // do ids match?
                            var overrideSymbol = document.getSymbolMasterWithID(override.value);
                            if (overrideSymbol == undefined) { return }
                            currentLayer.name = overrideSymbol.name;
                            currentLayer.masterId = overrideSymbol.id;
                            currentLayer.layers = filterTypes( overrideSymbol );
                        }
                    }
                    //// it is TEXT ////
                    if (currentLayer.id == override.path) {      // do ids match?
						var text = override.value;
                        const layer = document.getLayerWithID(override.path);
                        if (layer?.type == sketch.Types.Text) {
                            switch (layer.style.textTransform) {
                            case 'uppercase':
                                text = text.toUpperCase();
                            case 'lowercase':
                                text = text.toLowerCase();
                            default:
                                break;
                            }
                        }
                        currentLayer[ override.property ] = text;  // replace the text/image value
                    }
                }
            }
        }
    }
}


//// get layer data: GROUP
function getGroup(layer) {
    var flip = getFlipMultiplier(layer);
	var layerData =  {
        type: 'Group',
        name: '\u25BD ' + layer.name,
        id: layer.id,
        frame: getFrame(layer),
        isVisible: !layer.hidden,
        opacity: getOpacity(layer),
        shadow: getShadows(layer),
        innerShadow: getInnerShadows(layer),
        rotation: -layer.transform.rotation * (flip[0]/100) * (flip[1]/100),
        blendMode: layer.style.blendingMode,
        flip: flip,
        // FIXME: <rodionovd>
        hasClippingMask: layer.sketchObject.hasClippingMask(),
        shouldBreakMaskChain: layer.sketchObject.shouldBreakMaskChain(),
        layers: filterTypes(layer),
    }
    // UI.alert('layerData', JSON.stringify(layerData.layers[0].hasClippingMask, false, 2))
    if (layerData.layers[0].hasClippingMask) { layerData.type = 'Component'}

    return layerData;
}


//// get layer data: TEXT
function getText(layer) {
    /// reset vars
    var kind;
    var frame = {};

    /// is the layer flipped?
    var flip = getFlipMultiplier(layer);

    /// point or area text box
    if (!layer.fixedWidth) {
        kind = 'Point';
        frame = {
            x: layer.frame.x,
            // FIXME: <rodionovd> expose MSTextLayer.glyphBounds() in JS API?
            y: layer.frame.y + layer.sketchObject.glyphBounds().origin.y,
            width: layer.frame.width,
            height: layer.frame.height
        }
    } else {
        kind = 'Area';
        frame = {
            x: layer.frame.x + layer.frame.width / 2,
            // FIXME: <rodionovd> expose MSTextLayer.glyphBounds() in JS API?
            y: layer.frame.y + layer.frame.height / 2 + layer.sketchObject.glyphBounds().origin.y,
            width: layer.frame.width,
            height: layer.frame.height
        }
    }

    const TextAlignmentMap = {
        left: 0, // Visually left aligned
        right: 1, // Visually right aligned
        center: 2, // Visually centered
        justified: 3, // Fully-justified. The last line in a paragraph is natural-aligned.
        natural: 4, // Indicates the default alignment for script
    };  

	var layerData =  {
        type: 'Text',
        kind: kind,
		name: layer.name,
        stringValue: getTextString(layer),
		id: layer.id,
		frame: frame,
        isVisible: !layer.hidden,
		opacity: getOpacity(layer),
		shadow: getShadows(layer),
		innerShadow: getInnerShadows(layer),
        textColor: hexToArray(layer.style.textColor),
        fill: getFills(layer),
        stroke: getStrokes(layer),
		blendMode: getAELayerBlending(layer.style.blendingMode),
        fontName: layer.style.fontFamily,
        fontSize: layer.style.fontSize,
        trackingAdjusted: (layer.style.kerning ?? 0) / layer.style.fontSize * 1000,
        tracking: (layer.style.kerning ?? 0),
        justification: TextAlignmentMap[layer.style.alignment],
        lineHeight: layer.style.lineHeight || null,
        flip: flip,
        rotation: -layer.transform.rotation * (flip[0]/100) * (flip[1]/100),
        blur: getBlur(layer),
        // FIXME: <rodionovd>
        hasClippingMrask: layer.sketchObject.hasClippingMask(),
        shouldBreakMaskChain: layer.sketchObject.shouldBreakMaskChain(),
    };


    return layerData;

    function getTextString(layer) {
        var text = layer.text.replace(/[\u2028]/g, '\n');
        switch (layer.style.textTransform) {
        case 'none':
            return text;
        case 'uppercase':
            return text.toUpperCase();
        case 'lowercase':
            return text.toLowerCase();
        }
    }
}


//// get layer data: IMAGE
function getImage(layer, filldata) {
    
    try {
        var layerData = {
            type: 'Image',
            name: layer.name,
            id: layer.id,
            frame: getFrame(layer),
            isVisible: !layer.hidden,
            opacity: getOpacity(layer),
            blendMode: getAELayerBlending(layer.style.blendingMode),
            rotation: -layer.transform.rotation,
            // FIXME: <rodionovd> These Mask-related properties should be available via JS API
            hasClippingMask: layer.sketchObject.hasClippingMask(),
            shouldBreakMaskChain: layer.sketchObject.shouldBreakMaskChain(),
        }
        var imgData = ''
        
        // FIXME: <rodionovd> Sketch.ImageData should offer a `base64` property
        if (layer.image) {
            imgData = layer.image.nsdata.base64EncodedStringWithOptions(0).toString()
        } else {
            imgData = filldata.nsdata.base64EncodedStringWithOptions(0).toString()
        }

        imageList.push({
            name: `${layerData.name}_${layerData.id}.png`,
            imgData: `${imgData.replace(/<|>/g, '')}`
        })
        console.log(imageList)

        return layerData;
    } catch (error) {
        UI.alert('error', error)
    }
    
}

//// get layer data: COMPOUND SHAPE
function getCompoundShapes(layers) {
    var layerList = [];

    /// loop through all nested shapes
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var layerType = getCompoundShapeType(layer);

        // var layerId = (layer.objectID()+ '&').slice(0, -1);
        var flip = getFlipMultiplier(layer);
        var frame = {
            x: layer.frame.x,
            y: layer.frame.y,
            width: layer.frame.width,
            height: layer.frame.height,
        };
        layerList.push({
            type: layerType,
            name: layer.name,
    		id: layer.id,
    		frame: frame,
            isVisible: !layer.hidden,
            path: getPath(layer, frame),
            roundness: getCompoundRoundness(layer),
            flip: flip,
            rotation: -layer.transform.rotation * (flip[0]/100) * (flip[1]/100),
            // FIXME: <rodionovd> this should be available via JS API
            booleanOperation: layer.sketchObject.booleanOperation(),
        });

        if (layerType == 'CompoundShape') {
            layerList[i].layers = getCompoundShapes(layer.layers);
        }
    }

    return layerList;


    /// check the shape type
    function getCompoundShapeType(layer) {
        if (layer.type == sketch.Types.Shape) {
            return 'CompoundShape';
        }
        if (layer.type == sketch.Types.ShapePath) {
            switch (layer.shapeType) {
            case sketch.ShapePath.ShapeType.Rectangle:
                return 'Rect';
            case sketch.ShapePath.ShapeType.Oval:
                return 'Ellipse';
            default:
                return 'Path';
            }
        } 
        return 'Path';
    }

    /// get corner roundness clamped to the shape size
    function getCompoundRoundness(layer) {
        // TODO: <rodionovd> figure what this function actually does and whether it can be done via JS API
        return null;
        // try {
        //     var radius = layer.fixedRadius();
        //     var width = layer.frame().width();
        //     var height = layer.frame().height();
        //     var maxRad = Math.min(Math.min(width, height), radius);

        //     return maxRad/2;
        // } catch (e) {
        //     return null;
        // }
    }
}


//// get shape data: PATH
function getPath(layer, frame) {
    /// reset vars
    var points = [], inTangents = [], outTangents = [];

    /// get the path object
	const path = layer.points ?? [];
    // skip if no path on the current object (like a compound path )
    if (path.length == 0) {
        return { points: [], inTangents: [], outTangents: [], closed: false };
    }

    /// get the height and width to multiply point point coordinates
	var shapeSize = {
        w: frame.width,
        h: frame.height
	};

    /// loop through each point on the path
	for (var k = 0; k < path.length; k++) {
        // paths are normalized to 0-1 and scaled by a height and width multiplier
		var p = [	round100(path[k].point.x * shapeSize.w),
					round100(path[k].point.y * shapeSize.h) ];

        // if the current point has curves and needs tangent handles
		if (path[k].pointType !== sketch.ShapePath.PointType.Straight) {
            // tangent out of the point offset by the point coordinates onscreen
			var o = [round100(path[k].curveFrom.x * shapeSize.w - p[0]),
					 round100(path[k].curveFrom.y * shapeSize.h - p[1])];

            // tangent into the point offset by the point coordinates onscreen
			var i = [round100(path[k].curveTo.x * shapeSize.w - p[0]),
					 round100(path[k].curveTo.y * shapeSize.h - p[1])];

        // current point has no curves so tangets are at the same coordinate as the point
		} else {
			var o = [0,0];
			var i = [0,0];
		}

        // add current point and tangent with screen dimensions
		points.push(p);
		inTangents.push(i);
		outTangents.push(o);
	}

    // create object to store path data
	var pathObj = {
		points: points,
		inTangents: inTangents,
		outTangents: outTangents,
		closed: layer.closed
	}
	return pathObj;
}

//// get layer data: OPACITY
function getOpacity(layer) {
    return  Math.round(layer.style.opacity * 100)
}


//// get layer data: SHAPE TYPE
function getShapeType(layer) {
    if (layer.type == sketch.Types.Shape) {
        return 'CompoundShape';
    }
    if (layer.type == sketch.Types.ShapePath) {
        switch (layer.shapeType) {
        case sketch.ShapePath.ShapeType.Rectangle:
            return 'Rect';
        case sketch.ShapePath.ShapeType.Oval:
            return 'Ellipse';
        default:
            return 'Path';
        }
    } 
    return 'Path';
}


//// get layer data: FLIP
function getFlipMultiplier(layer) {
    const x = layer.transform.flippedHorizontally ? -100 : 100;
    const y = layer.transform.flippedVertically ? -100 : 100;
    return [x, y];
}


//// get layer data: FILL
function getFills(layer) {
    /// get layer style object
    var style = layer.style;

    /// check if the layer has at least one fill
	var hasFill = ( style.fills.length > 0 ) ? true : false;

    if (hasFill) {
		var fillData = [];
        var size = [layer.frame.width, layer.frame.height];

        // loop through all fills
        for (var i = 0; i < style.fills.length; i++) {
            var fill = style.fills[i];
            // FIXME: <rodionovd> Per-style-component blending mode should be exposed via JS API
            const nativeFillBlendingMode = layer.sketchObject.style().fills()[i].contextSettings().blendMode();

            // add fill to fillProps only if fill is enabled
            if (fill.enabled) {
                // fill is a gradient
                if (fill.fillType == 'Gradient') {
                    // UI.alert('gradient', JSON.stringify(fill.gradient.gradientType == 'Radial' ))
                    var color = hexToArray(fill.color)
                    var fillObj = {
                        type: 'gradient',
                        startPoint: [fill.gradient.from.x * size[0]  - layer.frame.width / 2,
                                     fill.gradient.from.y * size[1] - layer.frame.height / 2],
                        endPoint:   [fill.gradient.to.x * size[0] - layer.frame.width / 2,
                                     fill.gradient.to.y * size[1] - layer.frame.height / 2],
                        gradType: (fill.gradient.gradientType == 'Radial') ? 2 : 1,
                        gradient: getGradient(fill.gradient.stops),
                        opacity: Math.round(color[3] * 100),
                        blendMode: getAEShapeBlending(nativeFillBlendingMode),

    				}
                // fill is an image or texture
                } else if (fill.fillType == 'Pattern') {
                    // UI.alert('debug', JSON.stringify(fill, false, 2))
                    fillData = getImage(layer, fill.pattern.image)
                    break;
                // fill is a solid
                } else {
                    var color = hexToArray(fill.color)
                    var fillObj = {
    					type: 'fill',
    					enabled: fill.enabled,
    					color: color,
    					opacity: Math.round(color[3] * 100),
    					blendMode: getAEShapeBlending(nativeFillBlendingMode),
    				}
                }
                // UI.alert('gradient', JSON.stringify(fillObj, false, 2))
                // add obj string to array
				fillData.push(fillObj);
			}
		}
		return fillData;
	} else {
		return null;
    }
}


//// get layer data: STROKE
function getStrokes(layer) {
    /// get layer style object
    const style = layer.style;

    /// check if the layer has at least one stroke
    // FIXME: <rodionovd> This should prob check for the presence of at least one *enabled* border
    const hasStroke = ( style.borders.length > 0 ) ? true : false;

	if (!hasStroke) {
        return null;
    }
    const size = [layer.frame.width, layer.frame.height];
    const strokeData = style.borders.reduce((prev, border) => {
        if (!border.enabled) {
            return prev;
        }

        const lineCapStyleFromLineEnd = (lineEnd) => {
            const LineEndMap = { Butt: 0, Round: 1, Projecting: 2, };
            return LineEndMap[lineEnd] || 0;
        };
        const lineJoiStyleFromLineJoin = (lineJoin) => {
            const LineJoinMap = { Miter: 0, Round: 1, Bevel: 2, }
            return LineJoinMap[lineJoin] || 0;
        };

        const color = hexToArray(border.color);
        switch (border.fillType) {
        case sketch.Style.FillType.Gradient:
            return prev.concat({
                type: 'gradient',
                startPoint: [border.gradient.from.x * size[0] - layer.frame.width / 2,
                                border.gradient.from.y * size[1] - layer.frame.height / 2],
                endPoint:   [border.gradient.to.x * size[0] - layer.frame.width / 2,
                                border.gradient.to.y * size[1] - layer.frame.height / 2],
                gradType: (border.gradient.gradientType == Style.GradientType.Radial) ? 2 : 1,
                gradient: getGradient(border.gradient.stops),
                opacity: color[3] * 100,
                width: border.thickness,
                cap: lineCapStyleFromLineEnd(style.borderOptions.lineEnd),
                join: lineJoiStyleFromLineJoin(style.borderOptions.lineJoin),
                strokeDashes: style.borderOptions.dashPattern,
                // FIXME: <rodionovd> this should be available via JS API
                blendMode: getAEShapeBlending(border.sketchObject.contextSettings().blendMode()),
            });
        case sketch.Style.FillType.Color:
        // FIXME: <rodionovd> this follows the original implementation but we should probably
        // handle Patterns separately from solid colors?
        case sketch.Style.FillType.Pattern:
            return prev.concat({
                type: 'fill',
                enabled: border.enabled,
                color: color,
                opacity: color[3] * 100,
                width: border.thickness,
                cap: lineCapStyleFromLineEnd(style.borderOptions.lineEnd),
                join: lineJoiStyleFromLineJoin(style.borderOptions.lineJoin),
                strokeDashes: style.borderOptions.dashPattern,
                // FIXME: <rodionovd> this should be available via JS API
                blendMode: getAEShapeBlending(border.sketchObject.contextSettings().blendMode()),
            });
        }
    }, []);
}


//// get layer data: STROKE DASHES
// FIXME: <rodionovd> remove this?
function getDashes(borderOptions) {
    var dashPattern = borderOptions.dashPattern();
    var dashArray = [];

    for (var i = 0; i < dashPattern.length; i++) {
        var str = (dashPattern[i] + '&').slice(0, -1);
        dashArray.push( parseFloat(str) )
    }
    return dashArray;
}


//// get layer data: GRADIENT
function getGradient(grad) {
    var gradObj = {
        length: grad.length,
        points: []
    }

    for (var i = 0; i < gradObj.length; i++) {
        var colorArr = hexToArray(grad[i].color)
        gradObj.points.push({
            color: colorArr,
            midPoint: 0.5,
            opacity: colorArr[3],
            rampPoint: grad[i].position,
        })
    }
    
    return gradObj;
}


//// get layer data: DROP SHADOW
function getShadows(layer) {
	const hasShadow = layer.style.shadows.reduce((hasOneActiveShadow, shadow) => {
        return hasOneActiveShadow || shadow.enabled;
    }, false);

	if (hasShadow) {
		const shadowData = layer.style.shadows.reduce((prev, shadow) => {
            if (!shadow.enabled) {
                return prev;
            }
            return prev.concat({
                color: hexToArray(shadow.color),
                position: [shadow.x, shadow.y],
                blur: shadow.blur,
                spread: shadow.spread
            });
        }, []);
        return shadowData
	}

    return null;
}


//// get layer data: INNER SHADOW
function getInnerShadows(layer) {
	const hasInnerShadow = layer.style.innerShadows.reduce((hasOneActiveInnerShadow, shadow) => {
        return hasOneActiveInnerShadow || shadow.enabled;
    }, false);

	if (hasInnerShadow) {
		const shadowData = layer.style.innerShadows.reduce((prev, shadow) => {
            if (!shadow.enabled) {
                return prev;
            }
            return prev.concat({
                color: hexToArray(shadow.color),
                position: [shadow.x, shadow.y],
                blur: shadow.blur,
                spread: shadow.spread
            });
        }, []);
        return shadowData
	}

    return null;
}


//// get layer data: BLUR
function getBlur(layer) {
    const blur = layer.style.blur;
    if (!blur || !blur.enabled) {
        return null;
    }

    const BlurTypeMap = { Gaussian: 0, Motion: 1, Zoom: 2, Background: 3 }
    return [{
        direction: (90 - blur.motionAngle) % 360,
        radius: blur.radius * 4,
        type: BlurTypeMap[blur.type],
    }];
}
//// DEPRECIATED copy text to clipboard
// function copy_text(txt){
//     var pasteBoard = NSPasteboard.generalPasteboard();
// 		pasteBoard.clearContents();
// 		pasteBoard.declareTypes_owner(NSArray.arrayWithObject(NSPasteboardTypeString), null);
//         pasteBoard.setString_forType(txt, NSPasteboardTypeString);
// }


//// save data to text file
function save_text(text, filePath) {
    var t = NSString.stringWithFormat("%@", text);
    var f = NSString.stringWithFormat("%@", filePath);
    return t.writeToFile_atomically_encoding_error(f, true, NSUTF8StringEncoding, null);
}


//// open dialog and return path
function getFolderPath() {
	if (exportCanceled) { return false; }		// cancel the process
	if (folderPath == null) {
		var saveWindow = NSOpenPanel.openPanel();
		saveWindow.setCanCreateDirectories(true);
		saveWindow.setCanChooseDirectories(true);
		saveWindow.setCanChooseFiles(false);

		saveWindow.setPrompt('Select');
		saveWindow.setMessage('Location to save images');
		var pathSaved = saveWindow.runModal();

        if (pathSaved) {
            folderPath = decodeURI(saveWindow.URLs().objectAtIndex(0));
    		folderPath = folderPath.replace('file://', '');                    // remove the file://

            return true;            // folder path found
        }

        exportCanceled = true;      // canceled
        return false;
	}
    return true;        // folder path exists
}


//// save dialog and return path
function getSavePath() {
	if (exportCanceled) { return false }		// cancel the process
	if (folderPath == null) {
		var saveWindow = NSSavePanel.savePanel();
		saveWindow.setCanCreateDirectories(true);
		saveWindow.setCanChooseDirectories(true);
		saveWindow.setCanChooseFiles(false);

		saveWindow.setPrompt('Select');
		saveWindow.setMessage('Location to save json file and any images');
        saveWindow.nameFieldStringValue = toolName + '.json';
		// saveWindow.allowedFileTypes(['json']);
		var pathSaved = saveWindow.runModal();

        if (pathSaved) {
            folderPath = decodeURI(saveWindow.URLs().objectAtIndex(0));
    		folderPath = folderPath.replace('file://', '');                    // remove the file://

            saveName = saveWindow.nameFieldStringValue();
            return true;            // folder path found
        }

        exportCanceled = true;      // canceled
        return false;
	}
    return true;        // folder path exists
}

//// rearrange origin of a shape
function getFrame(layer) {
  var frame = layer.frame;

  return {
    width: frame.width,
    height: frame.height,
    x: frame.x + frame.width/2,
    y: frame.y + frame.height/2,
  }
}


//// reduce math resolution
function round100(num) {
	return Math.round(num * 100) / 100;
}


//// return enumerated layer blending mode
function getAELayerBlending(jsBlendingMode) {
    switch (jsBlendingMode) {
    case sketch.Style.BlendingMode.Darken:
        return 'BlendingMode.DARKEN';
    case sketch.Style.BlendingMode.Multiply:
        return 'BlendingMode.MULTIPLY';
    case sketch.Style.BlendingMode.ColorBurn:
        return 'BlendingMode.COLOR_BURN';
    case sketch.Style.BlendingMode.Lighten:
        return 'BlendingMode.LIGHTEN';
    case sketch.Style.BlendingMode.Screen:
        return 'BlendingMode.SCREEN';
    case sketch.Style.BlendingMode.ColorDodge:
        return 'BlendingMode.ADD';
    case sketch.Style.BlendingMode.Overlay:
        return 'BlendingMode.OVERLAY';
    case sketch.Style.BlendingMode.SoftLight:
        return 'BlendingMode.SOFT_LIGHT';
    case sketch.Style.BlendingMode.HardLight:
        return 'BlendingMode.HARD_LIGHT';
    case sketch.Style.BlendingMode.Difference:
        return 'BlendingMode.DIFFERENCE';
    case sketch.Style.BlendingMode.Exclusion:
        return 'BlendingMode.EXCLUSION';
    case sketch.Style.BlendingMode.Hue:
        return 'BlendingMode.HUE';
    case sketch.Style.BlendingMode.Saturation:
        return 'BlendingMode.SATURATION';
    case sketch.Style.BlendingMode.Color:
        return 'BlendingMode.COLOR';
    case sketch.Style.BlendingMode.Luminosity:
        return 'BlendingMode.LUMINOSITY'; 
    default:
        return 'BlendingMode.NORMAL';
    }
}

//// return integer layer blending mode
function getAEShapeBlending(nativeBlendingMode) {
    switch (nativeBlendingMode) {
    case sketch.Style.BlendingMode.Darken:
        return 3;
    case sketch.Style.BlendingMode.Multiply:
        return 4;
    case sketch.Style.BlendingMode.ColorBurn:
        return 5;
    case sketch.Style.BlendingMode.Lighten:
        return 9;
    case sketch.Style.BlendingMode.Screen:
        return 10;
    case sketch.Style.BlendingMode.ColorDodge:
        return 11;
    case sketch.Style.BlendingMode.Overlay:
        return 15;
    case sketch.Style.BlendingMode.SoftLight:
        return 16;
    case sketch.Style.BlendingMode.HardLight:
        return 17;
    case sketch.Style.BlendingMode.Difference:
        return 23;
    case sketch.Style.BlendingMode.Exclusion:
        return 24;
    case sketch.Style.BlendingMode.Hue:
        return 26;
    case sketch.Style.BlendingMode.Saturation:
        return 27;
    case sketch.Style.BlendingMode.Color:
        return 28;
    case sketch.Style.BlendingMode.Luminosity:
        return 29; 
    default:
        return 1;
    }
}


//// convert hex color to array
function hexToArray(hexString) {
	var hexColor = hexString.replace('#', '');
	var r = parseInt(hexColor.slice(0, 2), 16) / 255,
		g = parseInt(hexColor.slice(2, 4), 16) / 255,
        b = parseInt(hexColor.slice(4, 6), 16) / 255,
        a = (hexColor.length > 6) ? parseInt(hexColor.slice(6, 8), 16) / 255 : 1
	return [r, g, b, a];
}