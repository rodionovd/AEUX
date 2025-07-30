import BrowserWindow from "sketch-module-web-view";
import { getWebview } from "sketch-module-web-view/remote";
const sketch = require("sketch");
const UI = require("sketch/ui");
const Settings = require("sketch/settings");
const { Buffer } = require("buffer");

export function getPluginBrowserWindow(options = { createIfNeeded: true }) {
  const identifier = "aeux.webview";
  const darkMode = UI.getTheme() === "dark";

  const existingBrowserWindow = getWebview(identifier);
  if (existingBrowserWindow) {
    // Make sure to adapt the UI to theme changes
    existingBrowserWindow.webContents.executeJavaScript(
      `setDarkMode(${darkMode})`
    );
    existingBrowserWindow.webContents.executeJavaScript(
      `setPrefs(${Settings.settingForKey("aeuxPrefs")})`
    );
    return existingBrowserWindow;
  } else if (!options.createIfNeeded) {
    return undefined;
  }

  const browserWindow = new BrowserWindow({
    identifier: identifier,
    width: 158,
    height: 212,
    titleBarStyle: "hiddenInset",
    remembersWindowFrame: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      devTools: true,
    },
  });

  browserWindow.loadURL(require("../resources/webview.html"));
  browserWindow.once("ready-to-show", () => {
    browserWindow.show();
  });
  browserWindow.on("closed", () => {
    // NOTE: this callback is intentionally left blank
  });
  browserWindow.webContents.executeJavaScript(`setDarkMode(${darkMode})`);
  browserWindow.webContents.executeJavaScript(
    `setPrefs(${Settings.settingForKey("aeuxPrefs")})`
  );

  browserWindow.webContents.on("setPrefs", (prefs) => {
    Settings.setSettingForKey("aeuxPrefs", prefs);
  });
  browserWindow.webContents.on("nativeLog", (s) => {
    UI.message(s);
    webContents
      .executeJavaScript(`setRandomNumber(${Math.random()})`)
      .catch(console.error);
  });
  browserWindow.webContents.on("externalLinkClicked", (url) => {
    NSWorkspace.sharedWorkspace().openURL(NSURL.URLWithString(url));
  });
  browserWindow.webContents.on("fetchAEUX", () => {
    exportToAEUX();
  });
  browserWindow.webContents.on("flattenCompounds", () => {
    flattenSelection();
  });
  browserWindow.webContents.on("detachSymbols", () => {
    detachSelection();
  });
}

function displayToast(message) {
  const window = getPluginBrowserWindow({ createIfNeeded: false });
  if (window) {
    window.webContents.executeJavaScript(`setFooterMsg('${message}')`);
  } else {
    UI.message(message);
  }
}

export function openPanel() {
  const _ = getPluginBrowserWindow({ createIfNeeded: true });
}

export function onShutdown() {
  const pluginBrowserWindow = getPluginBrowserWindow({ createIfNeeded: false });
  if (pluginBrowserWindow) {
    pluginBrowserWindow.close();
  }
}

// ========================================
// Detach symbols in selection
// ========================================

export function detachSelection(_) {
  let counter = 0;
  const detachSymbolsInHierarchy = (layer) => {
    if (layer.type === sketch.Types.SymbolInstance) {
      layer.detach({ recursively: true });
      counter++;
    } else if (
      [sketch.Types.Group, sketch.Types.Artboard].includes(layer.type)
    ) {
      layer.layers.forEach(detachSymbolsInHierarchy);
    }
  };
  const document = sketch.getSelectedDocument();
  document.selectedLayers.forEach((layer) => {
    detachSymbolsInHierarchy(layer);
  });

  displayToast(
    `Detached ${counter} symbol${counter === 1 ? "" : "s"} recursively`
  );
}

// ========================================
// Flatten compound shapes in selection
// ========================================

export function flattenSelection(_) {
  let counter = 0;
  const flattenShapesInHierarchy = (layer) => {
    if (layer.type === sketch.Types.Shape) {
      // FIXME <rodionovd> not exposed in JS API
      layer.sketchObject.flatten();
      counter++;
    } else if (
      [sketch.Types.Group, sketch.Types.Artboard].includes(layer.type)
    ) {
      layer.layers.forEach(flattenShapesInHierarchy);
    }
  };
  const document = sketch.getSelectedDocument();
  document.selectedLayers.forEach((layer) => {
    flattenShapesInHierarchy(layer);
  });

  displayToast(`Flattened ${counter} shape${counter === 1 ? "" : "s"}`);
}

// ========================================
// Export layers and images to AE
// ========================================

export function exportToAEUX(_) {
  const document = sketch.getSelectedDocument();
  const selection = document.selectedLayers.layers;

  if (selection.length == 0) {
    displayToast("0 layers sent to AE (empty selection)");
    return;
  }

  // User has to either select an artboard...
  let artboard = selection.find(
    (layer) => layer.type === sketch.Types.Artboard
  );
  // ... or have a layer selected that belongs to an artboard
  if (!artboard) {
    artboard = selection
      .find((x) => x.getParentArtboard())
      ?.getParentArtboard();
  }
  if (!artboard) {
    displayToast("Please select an artboard");
    return;
  }

  const serializeArtboard = (artboard) => {
    const children = serializeLayers(artboard.layers, imageCollector);
    return children.toSpliced(0, 0, {
      type: "Artboard",
      aeuxVersion: 0.78,
      hostApp: "Sketch",
      name: artboard.name,
      bgColor: artboard.background.enabled
        ? AEConvertColor(artboard.background.color)
        : undefined,
      size: [artboard.frame.width, artboard.frame.height],
      layerCount: children.length,
    });
  };

  const imageCollector = {
    images: [],
  };
  const aeuxData = serializeArtboard(artboard, imageCollector);

  if (imageCollector.images.length < 1) {
    fetch(`http://127.0.0.1:7240/evalScript`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "buildLayers",
        data: { layerData: aeuxData },
        switch: "aftereffects",
        getPrefs: true,
      }),
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          throw Error("failed to connect");
        }
      })
      .then((json) => {
        // get back a message from Ae and display it at the bottom of Sketch
        displayToast("Successfully exported layers to AE");
      })
      .catch((e) => {
        console.error(e);
        displayToast("Unable to communicate with Ae");
      });
  } else {
    // save images
    fetch(`http://127.0.0.1:7240/writeFiles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        switch: "aftereffects",
        images: imageCollector.images,
        // path: imagePath,
        data: { layerData: aeuxData },
      }),
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          throw Error("failed to connect");
        }
      })
      .then((json) => {
        // get back a message from Ae and display it at the bottom of Sketch
        displayToast("Successfully exported layers to AE");
      })
      .catch((e) => {
        console.error(e);
        displayToast("Unable to communicate with Ae");
      });
  }
}

function serializeLayers(_layers, imageCollector) {
  return _layers.flatMap((layer) => {
    if (layer.hidden) {
      return [];
    }
    const AELayerGetBlurs = (layer) => {
      // FIXME: a shim to support both Sketch 2025.1 and 101
      return layer.style.blurs ?? [layer.style.blur];
    };
    const blurs = AELayerGetBlurs(layer).flatMap((blur) => {
      return AEConvertBlur(blur) || [];
    });
    const innerShadows = layer.style.innerShadows.flatMap((shadow) => {
      return AEConvertShadow(shadow) || [];
    });
    const fills = layer.style.fills.flatMap((fill) => {
      return AEConvertFill(fill, layer) || [];
    });
    const shadows = layer.style.shadows.flatMap((shadow) => {
      return AEConvertShadow(shadow) || [];
    });
    const borders = layer.style.borders.flatMap((border) => {
      return (
        AEConvertBorder(border, layer.style.borderOptions, layer.frame) || []
      );
    });

    switch (layer.type) {
      case sketch.Types.Group:
        const interpretAsComponent =
          layer.layers.length > 1 && AELayerIsMasked(layer.layers[0]);
        return {
          type: interpretAsComponent ? "Component" : "Group",
          name: "\u25BD " + layer.name,
          id: layer.id,
          frame: AELayerGetFrame(layer),
          isVisible: !layer.hidden,
          opacity: AEConvertOpacity(layer.style.opacity),
          shadow: shadows.length > 0 ? shadows : null,
          innerShadow: innerShadows.length > 0 ? innerShadows : null,
          rotation: AELayerGetRotation(layer),
          // NOTE: this is intentional (a raw number instead of layer.style.blendingMode, which is a string)
          blendMode: layer.style.sketchObject.contextSettings().blendMode(),
          flip: AELayerGetFlip(layer),
          hasClippingMask: AELayerIsMasked(layer),
          shouldBreakMaskChain: AELayerBreaksMaskChain(layer),
          layers: serializeLayers(layer.layers, imageCollector),
        };

      case sketch.Types.Shape:
      case sketch.Types.ShapePath:
        let baseShapeTraits = {
          name: layer.name,
          id: layer.id,
          type: AEShapeGetType(layer),
          frame:
            layer.parent.type == sketch.Types.Shape
              ? layer.frame
              : AELayerGetFrame(layer),
          isVisible: !layer.hidden,
          fill: fills.length > 0 ? fills : null,
          shadow: shadows.length > 0 ? shadows : null,
          innerShadow: innerShadows.length > 0 ? innerShadows : null,
          stroke: borders.length > 0 ? borders : null,
          path: AEShapeGetPath(layer),
          roundness: AELayerGetCornerRadius(layer),
          blur: blurs.length > 0 ? blurs : null,
          opacity: AEConvertOpacity(layer.style.opacity),
          rotation: AELayerGetRotation(layer),
          flip: AELayerGetFlip(layer),
          blendMode: AEConvertBlendingModeToString(layer.style.blendingMode),
          booleanOperation: AELayerGetBooleanOperation(layer),
          hasClippingMask: AELayerIsMasked(layer),
          shouldBreakMaskChain: AELayerBreaksMaskChain(layer),
        };

        let imageFill = (baseShapeTraits.fill || []).find((fill) => {
          return fill.type === "Image";
        });
        if (imageFill) {
          // Insert an artificial Image layer based on this image fill
          imageFill = {
            ...imageFill,
            name: layer.name,
            id: layer.id,
            frame: {
              ...layer.frame,
              x: layer.frame.width / 2,
              y: layer.frame.height / 2,
            },
            isVisible: !layer.hidden,
            opacity: AEConvertOpacity(layer.style.opacity),
            blendMode: AEConvertBlendingModeToString(layer.style.blendingMode),
            rotation: AELayerGetRotation(layer),
            hasClippingMask: true,
            shouldBreakMaskChain: AELayerBreaksMaskChain(layer),
          };
          // And remove the original image fill from the shape layer
          baseShapeTraits = {
            ...baseShapeTraits,
            fill: [
              {
                type: "fill",
                enabled: true,
                color: [0.5, 0.5, 0.5, 1],
                opacity: 100,
                blendMode: 1,
              },
            ],
            frame: {
              ...baseShapeTraits.frame,
              x: layer.frame.width / 2,
              y: layer.frame.height / 2,
            },
            hasClippingMask: true,
          };

          const artificialComponent = {
            type: "Component",
            name: "\u25BD " + layer.name,
            id: layer.id,
            frame: AELayerGetFrame(layer),
            isVisible: !layer.hidden,
            opacity: AEConvertOpacity(layer.style.opacity),
            shadow: shadows.length > 0 ? shadows : null,
            innerShadow: innerShadows.length > 0 ? innerShadows : null,
            rotation: AELayerGetRotation(layer),
            blendMode: AEConvertBlendingModeToString(layer.style.blendingMode),
            flip: AELayerGetFlip(layer),
            hasClippingMask: AELayerIsMasked(layer),
            shouldBreakMaskChain: AELayerBreaksMaskChain(layer),
            layers:
              layer.type === sketch.Types.ShapePath
                ? [baseShapeTraits, imageFill]
                : serializeLayers(layer.layers, imageCollector),
          };

          imageCollector.images.push({
            name: `${layer.name}_${layer.id}.png`,
            imgData: `${imageFill.imgData.replace(/<|>/g, "")}`,
          });
          // NOTE: intentionally drop the image data we've already captured elsewhere
          delete imageFill.imgData;

          return artificialComponent;
        }

        if (layer.type == sketch.Types.Shape) {
          return {
            type: "CompoundShape",
            layers: serializeLayers(layer.layers, imageCollector),
            booleanOperation:
              // Note: this is intentional
              layer.layers.length > 0
                ? AELayerGetBooleanOperation(layer.layers[0])
                : AELayerGetBooleanOperation(layer),
            ...baseShapeTraits,
          };
        }
        return baseShapeTraits;

      case sketch.Types.SymbolInstance:
        // Workaround for a SketchAPI issue in 2025.1 where it wrongly enables
        // a white background for a SymbolMaster created from a native object
        // (e.g. via `new SymbolMaster()` in `layer.master` getter) even though
        // the native object has no background enabled.
        const masterName = String(layer.sketchObject.symbolMaster()?.name);
        const masterId = String(layer.sketchObject.symbolMaster()?.objectID());
        const masterFrame = (() => {
          const frame = layer.sketchObject.symbolMaster()?.frame();
          if (!frame) {
            return new sketch.Rectangle(0, 0, 0, 0);
          }
          return new sketch.Rectangle(
            frame.x(),
            frame.y(),
            frame.width(),
            frame.height()
          );
        })();

        if (!masterId) {
          // This symbol instance is invalid, don't bother exporting it
          return {};
        }
        const shadowDetachedCopy = (() => {
          // FIXME <rodionovd> not exposed in JS API
          layer.sketchObject.ensureDetachHasUpdated();
          let nativeDetachedGroup = layer.sketchObject
            .detachedInstance()
            .detachedGroup_replacements(true, null);
          return sketch.Group.fromNative(nativeDetachedGroup);
        })();

        return {
          type: "Group",
          name: masterName || "",
          masterId: masterId || "",
          id: layer.id,
          frame: AELayerGetFrame(layer),
          fill: fills.length > 0 ? fills : null,
          shadow: shadows.length > 0 ? shadows : null,
          innerShadow: innerShadows.length > 0 ? innerShadows : null,
          stroke: borders.length > 0 ? borders : null,
          isVisible: !layer.hidden,
          opacity: AEConvertOpacity(layer.style.opacity),
          shadow: shadows.length > 0 ? shadows : null,
          innerShadow: innerShadows.length > 0 ? innerShadows : null,
          blendMode: AEConvertBlendingModeToString(layer.style.blendingMode),
          layers: serializeLayers(
            shadowDetachedCopy?.layers || [],
            imageCollector
          ),
          symbolFrame: masterFrame,
          rotation: AELayerGetRotation(layer),
          flip: AELayerGetFlip(layer),
          hasClippingMask: AELayerIsMasked(layer),
          shouldBreakMaskChain: AELayerBreaksMaskChain(layer),
        };

      case sketch.Types.Text:
        let kind = layer.fixedWidth ? "Area" : "Point";
        const frame = (() => {
          // FIXME <rodionovd> not exposed in JS API
          const glyphBounds = layer.sketchObject.glyphBounds();
          if (layer.fixedWidth) {
            return {
              x: layer.frame.x + layer.frame.width / 2,
              y: layer.frame.y + layer.frame.height / 2 + glyphBounds.origin.y,
              width: layer.frame.width,
              height: layer.frame.height,
            };
          } else {
            return {
              x: layer.frame.x,
              y: layer.frame.y + glyphBounds.origin.y,
              width: layer.frame.width,
              height: layer.frame.height,
            };
          }
        })();

        return {
          type: "Text",
          name: layer.name,
          id: layer.id,
          frame: frame,
          kind: kind,
          stringValue: AETextGetContents(layer),
          isVisible: !layer.hidden,
          opacity: AEConvertOpacity(layer.style.opacity),
          fill: fills.length > 0 ? fills : null,
          shadow: shadows.length > 0 ? shadows : null,
          innerShadow: innerShadows.length > 0 ? innerShadows : null,
          stroke: borders.length > 0 ? borders : null,
          blur: blurs.length > 0 ? blurs : null,
          blendMode: AEConvertBlendingModeToString(layer.style.blendingMode),
          fontName: AETextGetFontName(layer),
          fontSize: layer.style.fontSize,
          textColor: AEConvertColor(layer.style.textColor),
          trackingAdjusted:
            ((layer.style.kerning || 0) / layer.style.fontSize) * 1000,
          tracking: layer.style.kerning || 0,
          justification: AETextGetAlignment(layer),
          lineHeight: layer.style.lineHeight || null,
          flip: AELayerGetFlip(layer),
          rotation: AELayerGetRotation(layer),
          roundness: AELayerGetCornerRadius(layer),
          hasClippingMask: AELayerIsMasked(layer),
          shouldBreakMaskChain: AELayerBreaksMaskChain(layer),
        };

      case sketch.Types.Image:
        imageCollector.images.push({
          name: `${layer.name}_${layer.id}.png`,
          imgData: NSImageToPNGAsBase64String(layer.image.nsimage).replace(
            /<|>/g,
            ""
          ),
        });
        return {
          type: "Image",
          name: layer.name,
          id: layer.id,
          frame: AELayerGetFrame(layer),
          isVisible: !layer.hidden,
          opacity: AEConvertOpacity(layer.style.opacity),
          blendMode: AEConvertBlendingModeToString(layer.style.blendingMode),
          rotation: AELayerGetRotation(layer),
          hasClippingMask: AELayerIsMasked(layer),
          shouldBreakMaskChain: AELayerBreaksMaskChain(layer),
        };
      default:
        return null;
    }
  });
}

// MARK: - Lil helpers

function NSImageToPNGAsBase64String(nsimage) {
  let tiffData = nsimage.TIFFRepresentation();
  let bitmap = NSBitmapImageRep.imageRepWithData(tiffData);
  let pngData = bitmap.representationUsingType_properties(
    NSBitmapImageFileTypePNG,
    {}
  );
  return Buffer.from(pngData).toString("base64");
}

function AETextGetAlignment(textLayer) {
  const TextAlignmentMap = {
    left: 0,
    right: 1,
    center: 2,
    justified: 3,
    natural: 4,
  };
  return TextAlignmentMap[textLayer.style.alignment] ?? 0;
}

function AETextGetFontName(textLayer) {
  // FIXME <rodionovd> a font's PostScript name is not exposed in JS API
  return String(textLayer.sketchObject.font().fontName());
}

function AETextGetContents(textLayer) {
  var text = textLayer.text.replace(/[\u2028]/g, "\n");
  switch (textLayer.style.textTransform) {
    case "none":
      return text;
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
  }
}

function AEShapeGetType(shapeLayer) {
  switch (shapeLayer.type) {
    case sketch.Types.Shape:
      return shapeLayer.layers.length > 0 ? "CompoundShape" : "Path";
    case sketch.Types.ShapePath:
      // FIXME <rodionovd> not exposed in JS API
      if (shapeLayer.sketchObject.edited()) {
        return "Path";
      }
      switch (shapeLayer.shapeType) {
        case sketch.ShapePath.ShapeType.Rectangle:
          return "Rect";
        case sketch.ShapePath.ShapeType.Oval:
          return "Ellipse";
        default:
          return "Path";
      }
    default:
      return "Path";
  }
}

function AEShapeGetPath(shape) {
  switch (shape.type) {
    case sketch.Types.Shape:
      return {
        points: [],
        inTangents: [],
        outTangents: [],
        closed: false,
      };
    case sketch.Types.ShapePath:
      return shape.points.reduce(
        (props, point) => {
          // [sic] paths are normalized to 0-1 and scaled by a height and width multiplier
          const xp = [
            cutFloatPrecision(point.point.x * shape.frame.width),
            cutFloatPrecision(point.point.y * shape.frame.height),
          ];
          let xf = [0, 0];
          let xi = [0, 0];

          // [sic] if the current point has curves and needs tangent handles
          if (point.pointType !== sketch.ShapePath.PointType.Straight) {
            // [sic] tangent out of the point offset by the point coordinates onscreen
            xf = [
              cutFloatPrecision(point.curveFrom.x * shape.frame.width - xp[0]),
              cutFloatPrecision(point.curveFrom.y * shape.frame.height - xp[1]),
            ];
            // [sic] tangent into the point offset by the point coordinates onscreen
            xi = [
              cutFloatPrecision(point.curveTo.x * shape.frame.width - xp[0]),
              cutFloatPrecision(point.curveTo.y * shape.frame.height - xp[1]),
            ];
          }

          props.points.push(xp);
          props.inTangents.push(xi);
          props.outTangents.push(xf);

          return props;
        },
        // Initial value for props:
        {
          points: [],
          inTangents: [],
          outTangents: [],
          closed: shape.closed,
        }
      );
    default:
      return null;
  }
}

function AELayerGetBooleanOperation(layer) {
  // FIXME <rodionovd> not exposed in JS API
  return layer.sketchObject.booleanOperation();
}

function AELayerGetCornerRadius(layer) {
  if (layer.type !== sketch.Types.ShapePath) {
    return null;
  }
  if (layer.points.length < 1) {
    return null;
  }
  // NOTE: getting a corner radius of the first point only is intentional
  const radius = layer.points[0].cornerRadius;
  return Math.min(Math.min(layer.frame.width, layer.frame.height), radius);
}

function AELayerGetFlip(layer) {
  const x = layer.transform.flippedHorizontally ? -100 : 100;
  const y = layer.transform.flippedVertically ? -100 : 100;
  return [x, y];
}

function AELayerGetFrame(layer) {
  const frame = layer.frame;
  return {
    width: frame.width,
    height: frame.height,
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
}

function AELayerGetRotation(layer) {
  const flip = AELayerGetFlip(layer);
  return -layer.transform.rotation * (flip[0] / 100) * (flip[1] / 100);
}

function AELayerIsMasked(layer) {
  // FIXME <rodionovd> not exposed in JS API
  return layer.sketchObject.hasClippingMask();
}

function AELayerBreaksMaskChain(layer) {
  // FIXME <rodionovd> not exposed in JS API
  return layer.sketchObject.shouldBreakMaskChain();
}

function AEStyleFillGetBlendingModeCode(fill) {
  // FIXME <rodionovd> not exposed in JS API
  const mode = fill.sketchObject?.contextSettings
    ? fill.sketchObject.contextSettings().blendMode()
    : sketch.Style.BlendingMode.Normal;

  switch (mode) {
    case sketch.Style.BlendingMode.Normal:
      return 1;
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

// MARK: Data Conversion

function AEConvertBlur(blur) {
  if (!blur.enabled) {
    return null;
  }

  const BlurTypeMap = {
    Gaussian: 0,
    Motion: 1,
    Zoom: 2,
    Background: 3,
  };

  return {
    direction: (90 - blur.motionAngle) % 360,
    radius: blur.radius * 4,
    type: BlurTypeMap[blur.blurType] || 0,
  };
}

function AEConvertColor(hexString) {
  var hexColor = hexString.replace("#", "");
  var r = parseInt(hexColor.slice(0, 2), 16) / 255,
    g = parseInt(hexColor.slice(2, 4), 16) / 255,
    b = parseInt(hexColor.slice(4, 6), 16) / 255,
    a = hexColor.length > 6 ? parseInt(hexColor.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

function AEConvertOpacity(opacity) {
  return Math.round(opacity * 100);
}

function AEConvertShadow(shadow) {
  if (!shadow.enabled) {
    return null;
  }

  return {
    color: AEConvertColor(shadow.color),
    position: [shadow.x, shadow.y],
    blur: shadow.blur,
    spread: shadow.spread,
  };
}

function AEConvertGradient(gradient, hostingLayerFrame) {
  const width = hostingLayerFrame.width;
  const height = hostingLayerFrame.height;

  return {
    type: "gradient",
    opacity: AEConvertOpacity(AEConvertColor(gradient.stops[0].color)[3]),
    gradType: gradient.gradientType == sketch.Style.GradientType.Radial ? 2 : 1,
    startPoint: [
      gradient.from.x * width - width / 2,
      gradient.from.y * height - height / 2,
    ],
    endPoint: [
      gradient.to.x * width - width / 2,
      gradient.to.y * height - height / 2,
    ],
    gradient: {
      length: gradient.stops.length,
      points: gradient.stops.map((stop) => {
        return {
          color: AEConvertColor(stop.color),
          //  NOTE: intentionally 0..1, not 0..100?
          opacity: AEConvertColor(stop.color)[3],
          midPoint: 0.5, // NOTE: intentionally hardcoded?
          rampPoint: stop.position,
        };
      }),
    },
  };
}

function AEConvertFill(fill, hostingLayer) {
  if (!fill.enabled) {
    return null;
  }

  switch (fill.fillType) {
    case sketch.Style.FillType.Gradient:
      return {
        ...AEConvertGradient(fill.gradient, hostingLayer.frame),
        blendMode: AEStyleFillGetBlendingModeCode(fill),
      };
    case sketch.Style.FillType.Pattern:
      return {
        type: "Image",
        imgData: NSImageToPNGAsBase64String(fill.pattern.image.nsimage),
      };
    case sketch.Style.FillType.Color:
      return {
        type: "fill",
        enabled: fill.enabled,
        color: AEConvertColor(fill.color),
        opacity: AEConvertOpacity(AEConvertColor(fill.color)[3]),
        blendMode: AEStyleFillGetBlendingModeCode(fill),
      };
  }
}

function AEConvertBorder(border, borderOptions) {
  if (!border.enabled) {
    return null;
  }

  const AEConvertLineEnd = (lineEnd) => {
    const map = { Butt: 0, Round: 1, Projecting: 2 };
    return map[lineEnd] || 0;
  };
  const AEConvertLineJoin = (lineJoin) => {
    const map = { Miter: 0, Round: 1, Bevel: 2 };
    return map[lineJoin] || 0;
  };
  const sharedProperties = {
    enabled: border.enabled,
    width: border.thickness,
    cap: AEConvertLineEnd(borderOptions.lineEnd),
    join: AEConvertLineJoin(borderOptions.lineJoin),
    strokeDashes: borderOptions.dashPattern,
    blendMode: AEStyleFillGetBlendingModeCode(border),
  };

  switch (border.fillType) {
    case sketch.Style.FillType.Gradient:
      return {
        ...sharedProperties,
        ...AEConvertGradient(border.gradient, hostingLayerFrame),
      };
    case sketch.Style.FillType.Color:
      const color = AEConvertColor(border.color);
      return {
        ...sharedProperties,
        type: "fill",
        color: color,
        opacity: AEConvertOpacity(color[3]),
      };
    case sketch.Style.FillType.Pattern:
      // NOTE: intentionally unsupported configuration
      return null;
  }
}

function AEConvertBlendingModeToString(mode) {
  switch (mode) {
    case sketch.Style.BlendingMode.Darken:
      return "BlendingMode.DARKEN";
    case sketch.Style.BlendingMode.Multiply:
      return "BlendingMode.MULTIPLY";
    case sketch.Style.BlendingMode.ColorBurn:
      return "BlendingMode.COLOR_BURN";
    case sketch.Style.BlendingMode.Lighten:
      return "BlendingMode.LIGHTEN";
    case sketch.Style.BlendingMode.Screen:
      return "BlendingMode.SCREEN";
    case sketch.Style.BlendingMode.ColorDodge:
      return "BlendingMode.ADD";
    case sketch.Style.BlendingMode.Overlay:
      return "BlendingMode.OVERLAY";
    case sketch.Style.BlendingMode.SoftLight:
      return "BlendingMode.SOFT_LIGHT";
    case sketch.Style.BlendingMode.HardLight:
      return "BlendingMode.HARD_LIGHT";
    case sketch.Style.BlendingMode.Difference:
      return "BlendingMode.DIFFERENCE";
    case sketch.Style.BlendingMode.Exclusion:
      return "BlendingMode.EXCLUSION";
    case sketch.Style.BlendingMode.Hue:
      return "BlendingMode.HUE";
    case sketch.Style.BlendingMode.Saturation:
      return "BlendingMode.SATURATION";
    case sketch.Style.BlendingMode.Color:
      return "BlendingMode.COLOR";
    case sketch.Style.BlendingMode.Luminosity:
      return "BlendingMode.LUMINOSITY";
    default:
      return "BlendingMode.NORMAL";
  }
}

function cutFloatPrecision(num, digits = 2) {
  const multiplier = Math.pow(10, digits);
  return Math.round(num * multiplier) / multiplier;
}
