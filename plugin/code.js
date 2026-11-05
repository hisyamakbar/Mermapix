(function() {
	//#region plugin/src/markers.ts
	function parsePathGeometry(d) {
		if (!d || typeof d !== "string") return null;
		const commandRegex = /([a-df-z])([^a-df-z]*)/gi;
		const segments = [];
		let match;
		while ((match = commandRegex.exec(d)) !== null) {
			const cmd = match[1];
			const argsStr = match[2].trim();
			const args = [];
			if (argsStr) {
				const numRegex = /[-+]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?/g;
				let numMatch;
				while ((numMatch = numRegex.exec(argsStr)) !== null) args.push(parseFloat(numMatch[0]));
			}
			segments.push({
				cmd,
				args
			});
		}
		if (segments.length === 0) return null;
		let cx = 0;
		let cy = 0;
		let startPt = null;
		let startTan = null;
		let endTan = null;
		for (let s = 0; s < segments.length; s++) {
			const { cmd, args } = segments[s];
			const isRel = cmd === cmd.toLowerCase();
			const upper = cmd.toUpperCase();
			if (upper === "M") {
				if (args.length >= 2) {
					cx = isRel ? cx + args[0] : args[0];
					cy = isRel ? cy + args[1] : args[1];
					if (!startPt) startPt = {
						x: cx,
						y: cy
					};
					for (let i = 2; i < args.length - 1; i += 2) {
						const nx = isRel ? cx + args[i] : args[i];
						const ny = isRel ? cy + args[i + 1] : args[i + 1];
						if (!startTan) startTan = {
							x: nx - cx,
							y: ny - cy
						};
						endTan = {
							x: nx - cx,
							y: ny - cy
						};
						cx = nx;
						cy = ny;
					}
				}
			} else if (upper === "L") for (let i = 0; i < args.length - 1; i += 2) {
				const nx = isRel ? cx + args[i] : args[i];
				const ny = isRel ? cy + args[i + 1] : args[i + 1];
				if (!startTan) startTan = {
					x: nx - cx,
					y: ny - cy
				};
				endTan = {
					x: nx - cx,
					y: ny - cy
				};
				cx = nx;
				cy = ny;
			}
			else if (upper === "H") for (let i = 0; i < args.length; i++) {
				const nx = isRel ? cx + args[i] : args[i];
				if (!startTan) startTan = {
					x: nx - cx,
					y: 0
				};
				endTan = {
					x: nx - cx,
					y: 0
				};
				cx = nx;
			}
			else if (upper === "V") for (let i = 0; i < args.length; i++) {
				const ny = isRel ? cy + args[i] : args[i];
				if (!startTan) startTan = {
					x: 0,
					y: ny - cy
				};
				endTan = {
					x: 0,
					y: ny - cy
				};
				cy = ny;
			}
			else if (upper === "C") for (let i = 0; i < args.length - 5; i += 6) {
				const c1x = isRel ? cx + args[i] : args[i];
				const c1y = isRel ? cy + args[i + 1] : args[i + 1];
				const c2x = isRel ? cx + args[i + 2] : args[i + 2];
				const c2y = isRel ? cy + args[i + 3] : args[i + 3];
				const nx = isRel ? cx + args[i + 4] : args[i + 4];
				const ny = isRel ? cy + args[i + 5] : args[i + 5];
				if (!startTan) {
					const dx = c1x - cx;
					const dy = c1y - cy;
					if (dx !== 0 || dy !== 0) startTan = {
						x: dx,
						y: dy
					};
					else startTan = {
						x: nx - cx,
						y: ny - cy
					};
				}
				const edx = nx - c2x;
				const edy = ny - c2y;
				if (edx !== 0 || edy !== 0) endTan = {
					x: edx,
					y: edy
				};
				else endTan = {
					x: nx - cx,
					y: ny - cy
				};
				cx = nx;
				cy = ny;
			}
			else if (upper === "Q") for (let i = 0; i < args.length - 3; i += 4) {
				const qx = isRel ? cx + args[i] : args[i];
				const qy = isRel ? cy + args[i + 1] : args[i + 1];
				const nx = isRel ? cx + args[i + 2] : args[i + 2];
				const ny = isRel ? cy + args[i + 3] : args[i + 3];
				if (!startTan) startTan = {
					x: qx - cx,
					y: qy - cy
				};
				endTan = {
					x: nx - qx,
					y: ny - qy
				};
				cx = nx;
				cy = ny;
			}
		}
		const endPt = {
			x: cx,
			y: cy
		};
		if (!startPt) return null;
		const startAngle = startTan ? Math.atan2(startTan.y, startTan.x) * 180 / Math.PI : 0;
		const endAngle = endTan ? Math.atan2(endTan.y, endTan.x) * 180 / Math.PI : 0;
		return {
			start: {
				point: startPt,
				angle: startAngle
			},
			end: {
				point: endPt,
				angle: endAngle
			}
		};
	}
	function inlineSvgMarkers(svg) {
		if (!svg || typeof svg !== "string") return svg;
		if (!svg.includes("<marker")) return svg;
		const markers = /* @__PURE__ */ new Map();
		const markerRegex = /<marker\s+([\s\S]*?)>([\s\S]*?)<\/marker>/gi;
		let match;
		while ((match = markerRegex.exec(svg)) !== null) {
			const attrsStr = match[1];
			const content = match[2].trim();
			const idMatch = attrsStr.match(/id=["']([^"']+)["']/);
			if (!idMatch) continue;
			const id = idMatch[1];
			const refXMatch = attrsStr.match(/refX=["']([^"']+)["']/);
			const refYMatch = attrsStr.match(/refY=["']([^"']+)["']/);
			const viewBoxMatch = attrsStr.match(/viewBox=["']([^"']+)["']/);
			const widthMatch = attrsStr.match(/markerWidth=["']([^"']+)["']/);
			const heightMatch = attrsStr.match(/markerHeight=["']([^"']+)["']/);
			const strokeMatch = attrsStr.match(/stroke=["']([^"']+)["']/);
			const fillMatch = attrsStr.match(/fill=["']([^"']+)["']/);
			let viewBox = null;
			if (viewBoxMatch) {
				const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(parseFloat);
				if (parts.length === 4 && !parts.some(isNaN)) viewBox = [
					parts[0],
					parts[1],
					parts[2],
					parts[3]
				];
			}
			markers.set(id, {
				id,
				refX: refXMatch ? parseFloat(refXMatch[1]) : 0,
				refY: refYMatch ? parseFloat(refYMatch[1]) : 0,
				markerWidth: widthMatch ? parseFloat(widthMatch[1]) : 0,
				markerHeight: heightMatch ? parseFloat(heightMatch[1]) : 0,
				viewBox,
				stroke: strokeMatch ? strokeMatch[1] : null,
				fill: fillMatch ? fillMatch[1] : null,
				content
			});
		}
		if (markers.size === 0) return svg;
		const isDarkTheme = svg.includes("#1e293b") || svg.includes("#38bdf8") || svg.includes("#090d16") || svg.includes("rgb(30, 41, 59)") || svg.includes("rgb(56, 189, 248)") || svg.includes("data-theme=\"dark\"");
		function getPoints(pathElementStr) {
			const dataPointsMatch = pathElementStr.match(/data-points=["']([^"']+)["']/);
			if (dataPointsMatch) try {
				let decoded = "";
				if (typeof atob === "function") decoded = atob(dataPointsMatch[1]);
				else if (typeof Buffer !== "undefined") decoded = Buffer.from(dataPointsMatch[1], "base64").toString("utf-8");
				if (decoded) {
					const pts = JSON.parse(decoded);
					if (Array.isArray(pts) && pts.length >= 2) return pts.map((p) => ({
						x: parseFloat(p.x),
						y: parseFloat(p.y)
					}));
				}
			} catch (_unused) {}
			const dMatch = pathElementStr.match(/\bd=["']([^"']+)["']/);
			if (!dMatch) return null;
			const nums = dMatch[1].match(/[-+]?[0-9]*\.?[0-9]+/g);
			if (!nums || nums.length < 4) return null;
			const pts = [];
			for (let i = 0; i < nums.length - 1; i += 2) pts.push({
				x: parseFloat(nums[i]),
				y: parseFloat(nums[i + 1])
			});
			return pts.length >= 2 ? pts : null;
		}
		function createInlinedMarker(markerId, pos, angle, type, elementStroke) {
			const marker = markers.get(markerId);
			if (!marker) return "";
			let scaleTransform = "";
			if (marker.viewBox && marker.markerWidth && marker.markerHeight) scaleTransform = ` scale(${marker.markerWidth / marker.viewBox[2]}, ${marker.markerHeight / marker.viewBox[3]})`;
			const isSeqNum = marker.id.includes("sequencenumber");
			const isExtension = marker.id.includes("extension");
			const isComposition = marker.id.includes("composition");
			const isAggregation = marker.id.includes("aggregation");
			const isDependency = marker.id.includes("dependency");
			const isCross = marker.id.includes("cross");
			const isDark = isDarkTheme || Boolean(elementStroke && (elementStroke.includes("38bdf8") || elementStroke.includes("56, 189, 248") || elementStroke.includes("rgb(56, 189, 248)")));
			const cardBg = isDark ? "#1e293b" : "#ffffff";
			const defaultStroke = isDark ? "#38bdf8" : "#1f2733";
			let markerContent = marker.content;
			if (isSeqNum) markerContent = markerContent.replace(/\br=["'][0-9.]+["']/, "r=\"12\"");
			let strokeAttr = marker.stroke ? ` stroke="${marker.stroke}"` : "";
			let fillAttr = marker.fill ? ` fill="${marker.fill}"` : "";
			if (!fillAttr) {
				if (isExtension || isAggregation) fillAttr = ` fill="${cardBg}"`;
				else if (isSeqNum || isComposition || marker.id.includes("filled-head") || marker.id.includes("arrowhead") || marker.id.includes("point") || marker.id.includes("head")) fillAttr = ` fill="${elementStroke || defaultStroke}"`;
			}
			if (!strokeAttr) {
				if (isSeqNum) strokeAttr = " stroke=\"none\"";
				else if (isExtension || isComposition || isAggregation || isDependency || isCross || marker.id.includes("arrowhead") || marker.id.includes("crosshead") || marker.id.includes("point") || marker.id.includes("head")) strokeAttr = ` stroke="${elementStroke || defaultStroke}"`;
			}
			return `<g class="inlined-marker inlined-marker-${type} inlined-${isSeqNum ? "sequence-number-badge" : isExtension ? "extension-arrow" : isComposition ? "composition-diamond" : isAggregation ? "aggregation-diamond" : isDependency ? "dependency-arrow" : marker.id.includes("arrowhead") || marker.id.includes("point") || marker.id.includes("head") ? "arrowhead" : "marker"}" transform="translate(${pos.x}, ${pos.y}) rotate(${angle})${scaleTransform} translate(${-marker.refX}, ${-marker.refY})"${strokeAttr}${fillAttr}>${markerContent}</g>`;
		}
		let transformedSvg = svg.replace(/<path\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/path>)/gi, (fullMatch, attrs) => {
			const startMatch = attrs.match(/marker-start=["']url\(#?([^"')]+)\)["']/);
			const endMatch = attrs.match(/marker-end=["']url\(#?([^"')]+)\)["']/);
			if (!startMatch && !endMatch) return fullMatch;
			const strokeMatch = attrs.match(/\bstroke=["']([^"']+)["']/);
			const elementStroke = strokeMatch ? strokeMatch[1] : null;
			const dMatch = attrs.match(/\bd=["']([^"']+)["']/);
			const geometry = dMatch ? parsePathGeometry(dMatch[1]) : null;
			let generatedMarkers = "";
			if (startMatch) if (geometry === null || geometry === void 0 ? void 0 : geometry.start) generatedMarkers += createInlinedMarker(startMatch[1], geometry.start.point, geometry.start.angle, "start", elementStroke);
			else {
				const points = getPoints(fullMatch);
				if (points && points.length >= 2) {
					const dx = points[1].x - points[0].x;
					const dy = points[1].y - points[0].y;
					const angle = Math.atan2(dy, dx) * 180 / Math.PI;
					generatedMarkers += createInlinedMarker(startMatch[1], points[0], angle, "start", elementStroke);
				}
			}
			if (endMatch) if (geometry === null || geometry === void 0 ? void 0 : geometry.end) generatedMarkers += createInlinedMarker(endMatch[1], geometry.end.point, geometry.end.angle, "end", elementStroke);
			else {
				const points = getPoints(fullMatch);
				if (points && points.length >= 2) {
					const last = points[points.length - 1];
					const prev = points[points.length - 2];
					const dx = last.x - prev.x;
					const dy = last.y - prev.y;
					const angle = Math.atan2(dy, dx) * 180 / Math.PI;
					generatedMarkers += createInlinedMarker(endMatch[1], last, angle, "end", elementStroke);
				}
			}
			return fullMatch + generatedMarkers;
		});
		transformedSvg = transformedSvg.replace(/<line\s+([^>]*?)(\/?>)/gi, (fullMatch, attrs) => {
			const startMatch = attrs.match(/marker-start=["']url\(#?([^"')]+)\)["']/);
			const endMatch = attrs.match(/marker-end=["']url\(#?([^"')]+)\)["']/);
			if (!startMatch && !endMatch) return fullMatch;
			const x1Match = attrs.match(/\bx1=["']([^"']+)["']/);
			const y1Match = attrs.match(/\by1=["']([^"']+)["']/);
			const x2Match = attrs.match(/\bx2=["']([^"']+)["']/);
			const y2Match = attrs.match(/\by2=["']([^"']+)["']/);
			if (!x1Match || !y1Match || !x2Match || !y2Match) return fullMatch;
			const x1 = parseFloat(x1Match[1]);
			const y1 = parseFloat(y1Match[1]);
			const x2 = parseFloat(x2Match[1]);
			const y2 = parseFloat(y2Match[1]);
			if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return fullMatch;
			const strokeMatch = attrs.match(/\bstroke=["']([^"']+)["']/);
			const elementStroke = strokeMatch ? strokeMatch[1] : null;
			const dx = x2 - x1;
			const dy = y2 - y1;
			const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;
			let generatedMarkers = "";
			if (startMatch) generatedMarkers += createInlinedMarker(startMatch[1], {
				x: x1,
				y: y1
			}, angle, "start", elementStroke);
			if (endMatch) generatedMarkers += createInlinedMarker(endMatch[1], {
				x: x2,
				y: y2
			}, angle, "end", elementStroke);
			return fullMatch + generatedMarkers;
		});
		return transformedSvg;
	}
	//#endregion
	//#region plugin/src/naming.ts
	/** Mermaid ER entity group ids look like `<svgId>-entity-<Name>-<index>`. */
	var ENTITY_NAME_RE = /-entity-(.+)-(\d+)$/;
	/**
	* True for the GROUP that holds one ER entity table.
	* Excludes relationship edges (`…id_entity-A-0_entity-B-1_0`) and self-relationship
	* pieces (`…-entity-X-4-cyclic-special-1`). Decided on the exact layer name, never on
	* substrings like "edge"/"label", so a table named KNOWLEDGE_BASE is a normal entity.
	*/
	function isErdEntityName(name) {
		if (!name || typeof name !== "string") return false;
		if (name.includes("id_entity") || name.includes("cyclic-special")) return false;
		return ENTITY_NAME_RE.test(name);
	}
	/** Classify a Mermaid `<marker id="…">` into a stable kind. */
	function markerKindFromId(markerId) {
		const id = (markerId || "").toLowerCase();
		if (id.includes("sequencenumber")) return "sequence-number";
		if (id.includes("er-onlyone")) return "crowsfoot-only-one";
		if (id.includes("er-zeroorone")) return "crowsfoot-zero-or-one";
		if (id.includes("er-oneormore")) return "crowsfoot-one-or-more";
		if (id.includes("er-zeroormore")) return "crowsfoot-zero-or-more";
		if (id.includes("extension")) return "inheritance";
		if (id.includes("composition")) return "composition";
		if (id.includes("aggregation")) return "aggregation";
		if (id.includes("dependency")) return "dependency";
		if (id.includes("lollipop")) return "lollipop";
		if (id.includes("cross")) return "cross";
		if (id.includes("circle")) return "circle";
		if (id.includes("point") || id.includes("arrowhead") || id.includes("head")) return "arrowhead";
		return "marker";
	}
	var MARKER_ID_PREFIX = "inlined-marker";
	var MARKER_ID_RE = /^inlined-marker-\d+-([a-z-]+)-(start|end)$/;
	/** Unique SVG id given to an inlined marker `<g>`; Figma uses it as the layer name. */
	function buildMarkerLayerId(index, kind, position) {
		return `${MARKER_ID_PREFIX}-${index}-${kind}-${position}`;
	}
	var FIXED_MARKER_LABELS = {
		"sequence-number": "Sequence Number Badge",
		inheritance: "Inheritance Arrow",
		composition: "Composition Diamond",
		aggregation: "Aggregation Diamond",
		dependency: "Dependency Arrow",
		lollipop: "Lollipop",
		marker: "Marker"
	};
	var POSITIONED_MARKER_LABELS = {
		"crowsfoot-only-one": "Crow's Foot: only-one",
		"crowsfoot-zero-or-one": "Crow's Foot: zero-or-one",
		"crowsfoot-one-or-more": "Crow's Foot: one-or-more",
		"crowsfoot-zero-or-more": "Crow's Foot: zero-or-more",
		arrowhead: "Arrowhead",
		cross: "Cross",
		circle: "Circle"
	};
	/** Human layer name for a layer whose current name contains `inlined-marker`. */
	function markerLayerName(layerName) {
		const m = MARKER_ID_RE.exec((layerName || "").trim().toLowerCase());
		if (!m) return "Marker";
		const kind = m[1];
		const position = m[2];
		const fixed = FIXED_MARKER_LABELS[kind];
		if (fixed) return fixed;
		const positioned = POSITIONED_MARKER_LABELS[kind];
		return positioned ? `${positioned} (${position})` : "Marker";
	}
	/** Parent layer names (lowercased) whose unnamed vectors are connector lines. */
	function isConnectorLayerName(name) {
		const n = (name || "").toLowerCase();
		return /edgepath|edgelabel|(^|[^a-z0-9])l_[a-z0-9]|id_entity|cyclic-special/.test(n);
	}
	/** Parent layer names (lowercased) whose unnamed vectors are flowchart node shapes. */
	function isShapeLayerName(name) {
		const n = (name || "").toLowerCase();
		return n.includes("flowchart-") || /(^|\s)node(\s|$)/.test(n);
	}
	//#endregion
	//#region plugin/src/svgPrep.ts
	/**
	* The web app's buildExportSvg already inlines markers; inlining again would stack
	* every crow's foot / arrowhead / badge twice. Only inline when none are present.
	*/
	function ensureMarkersInlined(svg) {
		if (!svg || typeof svg !== "string") return svg;
		if (svg.includes("inlined-marker")) return svg;
		return inlineSvgMarkers(svg);
	}
	var SCAN_RE = /<(?:path|line)\b[^>]*>|<g\s+class="inlined-marker\s+inlined-marker-(start|end)\s+inlined-[^"]*"/g;
	function markerIdFromAttr(tag, attr) {
		const m = tag.match(new RegExp(`${attr}=["']url\\(#?([^"')]+)\\)["']`));
		return m ? m[1] : null;
	}
	/**
	* Figma's SVG importer ignores `class` but uses `id` as the layer name. Give each inlined
	* marker `<g>` a unique id encoding its kind (derived from the `marker-start`/`marker-end`
	* url of the path/line it was inlined after) and position.
	*/
	function nameInlinedMarkers(svg) {
		if (!svg || typeof svg !== "string" || !svg.includes("inlined-marker")) return svg;
		let out = "";
		let cursor = 0;
		let counter = 0;
		let lastStartId = null;
		let lastEndId = null;
		const re = new RegExp(SCAN_RE.source, "g");
		let m;
		while ((m = re.exec(svg)) !== null) {
			const position = m[1];
			if (!position) {
				lastStartId = markerIdFromAttr(m[0], "marker-start");
				lastEndId = markerIdFromAttr(m[0], "marker-end");
				continue;
			}
			const markerId = position === "start" ? lastStartId : lastEndId;
			counter += 1;
			const id = buildMarkerLayerId(counter, markerKindFromId(markerId), position);
			const openLen = 2;
			out += svg.slice(cursor, m.index + openLen) + ` id="${id}"`;
			cursor = m.index + openLen;
			const tagEnd = svg.indexOf(">", m.index);
			const depthRe = /<g\b|<\/g>/g;
			depthRe.lastIndex = tagEnd + 1;
			let depth = 1;
			let d;
			while (depth > 0 && (d = depthRe.exec(svg)) !== null) depth += d[0] === "</g>" ? -1 : 1;
			re.lastIndex = depth === 0 ? depthRe.lastIndex : tagEnd + 1;
		}
		return out + svg.slice(cursor);
	}
	/** Full pre-processing pipeline for the SVG received from the UI. */
	function prepareSvgForFigma(svg) {
		return nameInlinedMarkers(ensureMarkersInlined(svg));
	}
	//#endregion
	//#region plugin/src/theme.ts
	var SYSTEM_THEME_PRESETS = {
		light: {
			primaryColor: "#f8fafc",
			primaryTextColor: "#09090b",
			primaryBorderColor: "#e4e4e7",
			lineColor: "#e4e4e7",
			secondaryColor: "#ffffff",
			tertiaryColor: "#ffffff",
			background: "#ffffff",
			attributeBackgroundColorOdd: "#ffffff",
			attributeBackgroundColorEven: "#fafafa"
		},
		dark: {
			darkMode: "true",
			primaryColor: "#1e293b",
			primaryTextColor: "#f8fafc",
			primaryBorderColor: "#38bdf8",
			lineColor: "#38bdf8",
			secondaryColor: "#0f172a",
			tertiaryColor: "#1e293b",
			background: "#090d16",
			attributeBackgroundColorOdd: "#1e293b",
			attributeBackgroundColorEven: "#131b2e"
		}
	};
	function parseColorToFigma(colorStr) {
		if (!colorStr || typeof colorStr !== "string") return null;
		const str = colorStr.trim().toLowerCase();
		if (str.startsWith("#")) {
			let hex = str.slice(1);
			if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
			if (hex.length === 6) {
				const num = parseInt(hex, 16);
				if (!isNaN(num)) return {
					r: (num >> 16 & 255) / 255,
					g: (num >> 8 & 255) / 255,
					b: (num & 255) / 255
				};
			}
		}
		const rgbMatch = str.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/);
		if (rgbMatch) {
			const r = parseFloat(rgbMatch[1]) / 255;
			const g = parseFloat(rgbMatch[2]) / 255;
			const b = parseFloat(rgbMatch[3]) / 255;
			return {
				r: Math.min(1, Math.max(0, r)),
				g: Math.min(1, Math.max(0, g)),
				b: Math.min(1, Math.max(0, b))
			};
		}
		return null;
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.122.0/helpers/typeof.js
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.122.0/helpers/toPrimitive.js
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.122.0/helpers/toPropertyKey.js
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.122.0/helpers/defineProperty.js
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.122.0/helpers/objectSpread2.js
	function ownKeys(e, r) {
		var t = Object.keys(e);
		if (Object.getOwnPropertySymbols) {
			var o = Object.getOwnPropertySymbols(e);
			r && (o = o.filter(function(r) {
				return Object.getOwnPropertyDescriptor(e, r).enumerable;
			})), t.push.apply(t, o);
		}
		return t;
	}
	function _objectSpread2(e) {
		for (var r = 1; r < arguments.length; r++) {
			var t = null != arguments[r] ? arguments[r] : {};
			r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
				_defineProperty(e, r, t[r]);
			}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
				Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
			});
		}
		return e;
	}
	//#endregion
	//#region plugin/src/erdPaints.ts
	/** All VECTOR descendants in z-order (document order). */
	function collectEntityVectors(entity) {
		const out = [];
		function walk(n) {
			if (!n || n.removed) return;
			if (n.type === "VECTOR") out.push(n);
			else if ("children" in n) try {
				for (const child of n.children) walk(child);
			} catch (_unused) {}
		}
		walk(entity);
		return out;
	}
	var hasFill = (v) => Array.isArray(v.fills) && v.fills.length > 0 && v.fills[0].visible !== false;
	var hasStroke = (v) => Array.isArray(v.strokes) && v.strokes.length > 0 && v.strokes[0].visible !== false;
	var solid = (color) => [{
		type: "SOLID",
		color
	}];
	function extractErdPaints(vectors, rowCount, themeVariables) {
		const fillVectors = vectors.filter(hasFill);
		const strokeOnly = vectors.filter((v) => hasStroke(v) && !hasFill(v));
		let isDark = false;
		for (const v of fillVectors) {
			const c = v.fills[0].color;
			if (c && .299 * c.r + .587 * c.g + .114 * c.b < .45) isDark = true;
		}
		const tokens = _objectSpread2(_objectSpread2({}, isDark ? SYSTEM_THEME_PRESETS.dark : SYSTEM_THEME_PRESETS.light), themeVariables || {});
		const fallbackHeader = parseColorToFigma(tokens.primaryColor) || (isDark ? {
			r: .1176,
			g: .1608,
			b: .2314
		} : {
			r: 1,
			g: 1,
			b: 1
		});
		const fallbackOdd = parseColorToFigma(tokens.attributeBackgroundColorOdd) || (isDark ? {
			r: .1176,
			g: .1608,
			b: .2314
		} : {
			r: 1,
			g: 1,
			b: 1
		});
		const fallbackEven = parseColorToFigma(tokens.attributeBackgroundColorEven) || (isDark ? {
			r: .0745,
			g: .1059,
			b: .1804
		} : {
			r: .9804,
			g: .9804,
			b: .9804
		});
		const fallbackBorder = parseColorToFigma(tokens.primaryBorderColor) || (isDark ? {
			r: .2196,
			g: .7412,
			b: .9725
		} : {
			r: .8941,
			g: .8941,
			b: .9059
		});
		const headerSvg = fillVectors.length > 0;
		const headerFill = headerSvg ? fillVectors[0].fills : solid(fallbackHeader);
		const rowFills = [];
		const rowsSvg = [];
		for (let i = 0; i < rowCount; i++) {
			const v = fillVectors[i + 1];
			if (v) {
				rowFills.push(v.fills);
				rowsSvg.push(true);
			} else {
				rowFills.push(solid(i % 2 === 0 ? fallbackOdd : fallbackEven));
				rowsSvg.push(false);
			}
		}
		const borderVector = strokeOnly[0] || vectors.find(hasStroke);
		const borderSvg = Boolean(borderVector);
		return {
			headerFill,
			rowFills,
			border: borderVector ? borderVector.strokes : solid(fallbackBorder),
			isDark,
			fromSvg: {
				header: headerSvg,
				rows: rowsSvg,
				border: borderSvg
			}
		};
	}
	var MIN_COLUMN = 24;
	/**
	* Plan widths so every column fits its widest content (text width + cell padding),
	* summing exactly to `tableWidth`. The Name column takes the remainder. If the content
	* cannot fit, all columns shrink proportionally (the table keeps Mermaid's width so
	* connectors stay attached).
	*/
	function computeColumnWidths(tableWidth, c) {
		const need = (w) => Math.ceil(w) + 16 + 2;
		const needs = {
			type: c.hasType ? need(c.type) : 0,
			name: Math.max(MIN_COLUMN, need(c.name)),
			key: c.hasKey ? need(c.key) : 0,
			comment: c.hasComment ? need(c.comment) : 0
		};
		const total = needs.type + needs.name + needs.key + needs.comment;
		if (total <= tableWidth) {
			const fixed = needs.type + needs.key + needs.comment;
			return _objectSpread2(_objectSpread2({}, needs), {}, { name: tableWidth - fixed });
		}
		const scale = tableWidth / total;
		const shrink = (w) => w === 0 ? 0 : Math.max(MIN_COLUMN, Math.floor(w * scale));
		const type = shrink(needs.type);
		const key = shrink(needs.key);
		const comment = shrink(needs.comment);
		return {
			type,
			key,
			comment,
			name: Math.max(MIN_COLUMN, tableWidth - type - key - comment)
		};
	}
	//#endregion
	//#region plugin/src/erd.ts
	/**
	* Converts ERD table/entity groups into native Column-Based Auto Layout Frames
	* (modeled after user reference table 13:1284 "Content"):
	*  - Main Table Card: Vertical Auto Layout, border stroke.
	*  - Header: Horizontal Auto Layout with table name and bottom border separator.
	*  - Content: Horizontal Auto Layout container holding vertical Column frames
	*    (Type | Field Name | Key | Comment), every cell uniform height with bottom border.
	*/
	function convertErdTables(rootNode, themeVariables) {
		const entityContainers = [];
		function findEntities(n) {
			if (!n || n.removed) return;
			if (n.type === "GROUP" && isErdEntityName(n.name)) {
				entityContainers.push(n);
				return;
			}
			const name = (n.name || "").toLowerCase();
			if (name.includes("id_entity") || name.includes("cyclic-special") || name.includes("inlined-marker")) return;
			if ("children" in n && !n.removed) try {
				for (const child of [...n.children]) if (child && !child.removed) findEntities(child);
			} catch (_unused) {}
		}
		findEntities(rootNode);
		for (const entity of entityContainers) {
			if (!entity || entity.removed) continue;
			const texts = [];
			function scanEntityTexts(n) {
				if (!n || n.removed) return;
				if (n.type === "TEXT") {
					if ((n.characters || "").trim().length > 0) texts.push(n);
				} else if ("children" in n && !n.removed) try {
					for (const child of [...n.children]) if (child && !child.removed) scanEntityTexts(child);
				} catch (_unused2) {}
			}
			scanEntityTexts(entity);
			if (texts.length === 0) continue;
			texts.sort((a, b) => a.y - b.y);
			const rows = [];
			let currentRow = [];
			let currentY = null;
			for (const t of texts) if (currentY === null || Math.abs(t.y - currentY) > 12) {
				if (currentRow.length > 0) rows.push(currentRow);
				currentRow = [t];
				currentY = t.y;
			} else currentRow.push(t);
			if (currentRow.length > 0) rows.push(currentRow);
			for (const row of rows) row.sort((a, b) => a.x - b.x);
			const headerTexts = rows[0] || [];
			const tableName = headerTexts.map((t) => t.characters.trim()).join(" ") || "Entity";
			const columnRows = rows.slice(1);
			function applyFont(t, style, size) {
				try {
					t.fontName = {
						family: "Inter",
						style
					};
					t.fontSize = size;
				} catch (_unused3) {}
				try {
					t.textAutoResize = "WIDTH_AND_HEIGHT";
				} catch (_unused4) {}
			}
			const adoptedTextIds = /* @__PURE__ */ new Set();
			let maxTypeWidth = 0;
			let maxNameWidth = 0;
			let maxBadgeWidth = 0;
			let maxCommentWidth = 0;
			let hasType = false;
			let hasBadges = false;
			let hasComments = false;
			const parsedRows = [];
			for (const rowTexts of columnRows) {
				const badges = [];
				const contentTexts = [];
				for (const t of rowTexts) {
					const char = (t.characters || "").trim();
					if (/^(PK|FK|UK|PK,\s*FK|FK,\s*UK|PK\s*FK|NULL|NOT NULL)$/i.test(char)) badges.push(t);
					else contentTexts.push(t);
				}
				let typeText = null;
				let nameText = null;
				let commentTexts = [];
				if (contentTexts.length === 1) nameText = contentTexts[0];
				else if (contentTexts.length === 2) {
					typeText = contentTexts[0];
					nameText = contentTexts[1];
				} else if (contentTexts.length >= 3) {
					typeText = contentTexts[0];
					nameText = contentTexts[1];
					commentTexts = contentTexts.slice(2);
				}
				if (typeText) applyFont(typeText, "Regular", 12);
				if (nameText) applyFont(nameText, "Regular", 12);
				for (const b of badges) applyFont(b, "Bold", 12);
				for (const c of commentTexts) applyFont(c, "Regular", 12);
				if (typeText) {
					hasType = true;
					maxTypeWidth = Math.max(maxTypeWidth, Math.ceil(typeText.width));
				}
				if (nameText) maxNameWidth = Math.max(maxNameWidth, Math.ceil(nameText.width));
				if (badges.length > 0) {
					hasBadges = true;
					const rowBadgeWidth = badges.reduce((sum, b) => sum + Math.ceil(b.width), 0) + 4 * (badges.length - 1);
					maxBadgeWidth = Math.max(maxBadgeWidth, rowBadgeWidth);
				}
				if (commentTexts.length > 0) {
					hasComments = true;
					const rowCommentWidth = commentTexts.reduce((sum, c) => sum + Math.ceil(c.width), 0) + 4 * (commentTexts.length - 1);
					maxCommentWidth = Math.max(maxCommentWidth, rowCommentWidth);
				}
				parsedRows.push({
					typeText,
					nameText,
					badges,
					commentTexts,
					typeName: typeText ? typeText.characters.trim() : "",
					fieldName: nameText ? nameText.characters.trim() : "",
					badgeNames: badges.map((b) => b.characters.trim()),
					commentStr: commentTexts.map((c) => c.characters.trim()).join(" ")
				});
			}
			const origEntityWidth = entity.width || 200;
			const origEntityHeight = entity.height || 120;
			const origEntityX = entity.x;
			const origEntityY = entity.y;
			const tableWidth = origEntityWidth;
			const tableX = origEntityX;
			const tableY = origEntityY;
			const colWidths = computeColumnWidths(tableWidth, {
				type: maxTypeWidth,
				name: maxNameWidth,
				key: maxBadgeWidth,
				comment: maxCommentWidth,
				hasType,
				hasKey: hasBadges,
				hasComment: hasComments
			});
			const typeColWidth = colWidths.type;
			const badgeColWidth = colWidths.key;
			const commentColWidth = colWidths.comment;
			const nameColInitialWidth = colWidths.name;
			const paints = extractErdPaints(collectEntityVectors(entity), parsedRows.length, themeVariables);
			const headerBgFill = paints.headerFill;
			const cardBgFill = headerBgFill;
			const tableBorder = paints.border;
			const rowFills = paints.rowFills;
			const totalRowCount = parsedRows.length > 0 ? parsedRows.length + 1 : 1;
			const cellHeight = parsedRows.length > 0 ? origEntityHeight / totalRowCount : 0;
			const headerHeight = origEntityHeight - cellHeight * parsedRows.length;
			const tableCard = figma.createFrame();
			tableCard.name = tableName;
			tableCard.x = tableX;
			tableCard.y = tableY;
			tableCard.layoutMode = "VERTICAL";
			tableCard.primaryAxisSizingMode = "FIXED";
			tableCard.counterAxisSizingMode = "FIXED";
			tableCard.resize(tableWidth, origEntityHeight);
			tableCard.itemSpacing = 0;
			tableCard.paddingTop = 0;
			tableCard.paddingBottom = 0;
			tableCard.paddingLeft = 0;
			tableCard.paddingRight = 0;
			tableCard.cornerRadius = 0;
			tableCard.fills = cardBgFill;
			tableCard.strokes = tableBorder;
			tableCard.strokeWeight = 1;
			tableCard.strokeAlign = "INSIDE";
			tableCard.clipsContent = true;
			const headerFrame = figma.createFrame();
			headerFrame.name = `Header: ${tableName}`;
			headerFrame.layoutMode = "HORIZONTAL";
			headerFrame.layoutAlign = "STRETCH";
			headerFrame.primaryAxisSizingMode = "FIXED";
			headerFrame.counterAxisSizingMode = "FIXED";
			headerFrame.resize(tableWidth, headerHeight);
			headerFrame.paddingTop = 0;
			headerFrame.paddingBottom = 0;
			headerFrame.paddingLeft = 8;
			headerFrame.paddingRight = 8;
			headerFrame.primaryAxisAlignItems = "CENTER";
			headerFrame.counterAxisAlignItems = "CENTER";
			headerFrame.itemSpacing = 8;
			headerFrame.fills = headerBgFill;
			if (tableBorder.length > 0) {
				headerFrame.strokes = tableBorder;
				headerFrame.strokeBottomWeight = 1;
				headerFrame.strokeTopWeight = 0;
				headerFrame.strokeLeftWeight = 0;
				headerFrame.strokeRightWeight = 0;
				headerFrame.strokeAlign = "INSIDE";
			} else headerFrame.strokes = [];
			for (const ht of headerTexts) {
				ht.name = `Title: ${ht.characters.trim()}`;
				try {
					ht.fontName = {
						family: "Inter",
						style: "Bold"
					};
					ht.fontSize = 13;
				} catch (_unused5) {}
				try {
					ht.visible = true;
				} catch (_unused6) {}
				headerFrame.appendChild(ht);
				adoptedTextIds.add(ht.id);
			}
			tableCard.appendChild(headerFrame);
			const contentFrame = figma.createFrame();
			contentFrame.name = "Content";
			contentFrame.layoutMode = "HORIZONTAL";
			contentFrame.layoutAlign = "STRETCH";
			contentFrame.primaryAxisSizingMode = "FIXED";
			contentFrame.counterAxisSizingMode = "FIXED";
			contentFrame.resize(tableWidth, cellHeight * parsedRows.length);
			contentFrame.itemSpacing = 0;
			contentFrame.paddingTop = 0;
			contentFrame.paddingBottom = 0;
			contentFrame.paddingLeft = 0;
			contentFrame.paddingRight = 0;
			contentFrame.fills = [];
			contentFrame.strokes = [];
			function createColumn(name, isFillWidth, initialWidth, hasRightDivider) {
				const col = figma.createFrame();
				col.name = `Column: ${name}`;
				col.layoutMode = "VERTICAL";
				col.layoutAlign = "STRETCH";
				col.primaryAxisSizingMode = "FIXED";
				col.counterAxisSizingMode = isFillWidth ? "AUTO" : "FIXED";
				col.resize(initialWidth, cellHeight * parsedRows.length);
				if (isFillWidth) col.layoutGrow = 1;
				else col.layoutGrow = 0;
				col.itemSpacing = 0;
				col.paddingTop = 0;
				col.paddingBottom = 0;
				col.paddingLeft = 0;
				col.paddingRight = 0;
				col.fills = [];
				if (hasRightDivider && tableBorder.length > 0) {
					col.strokes = tableBorder;
					col.strokeRightWeight = 1;
					col.strokeTopWeight = 0;
					col.strokeBottomWeight = 0;
					col.strokeLeftWeight = 0;
					col.strokeAlign = "INSIDE";
				} else col.strokes = [];
				return col;
			}
			function createCell(name, width, isLastRow, align, fills) {
				const cell = figma.createFrame();
				cell.name = name ? `Cell: ${name}` : "Cell";
				cell.layoutMode = "HORIZONTAL";
				cell.layoutAlign = "STRETCH";
				cell.primaryAxisSizingMode = "FIXED";
				cell.counterAxisSizingMode = "FIXED";
				cell.resize(width, cellHeight);
				cell.paddingLeft = 8;
				cell.paddingRight = 8;
				cell.paddingTop = 0;
				cell.paddingBottom = 0;
				cell.primaryAxisAlignItems = align;
				cell.counterAxisAlignItems = "CENTER";
				cell.itemSpacing = 4;
				cell.fills = fills;
				if (!isLastRow && tableBorder.length > 0) {
					cell.strokes = tableBorder;
					cell.strokeBottomWeight = 1;
					cell.strokeTopWeight = 0;
					cell.strokeLeftWeight = 0;
					cell.strokeRightWeight = 0;
					cell.strokeAlign = "INSIDE";
				} else cell.strokes = [];
				return cell;
			}
			const columnsToRender = [];
			if (hasType) columnsToRender.push({
				type: "TYPE",
				name: "Type",
				width: typeColWidth,
				isFill: false,
				align: "MIN"
			});
			columnsToRender.push({
				type: "NAME",
				name: "Field Name",
				width: nameColInitialWidth,
				isFill: true,
				align: "MIN"
			});
			if (hasBadges) columnsToRender.push({
				type: "KEY",
				name: "Key",
				width: badgeColWidth,
				isFill: false,
				align: "CENTER"
			});
			if (hasComments) columnsToRender.push({
				type: "COMMENT",
				name: "Comment",
				width: commentColWidth,
				isFill: false,
				align: "MIN"
			});
			for (let cIdx = 0; cIdx < columnsToRender.length; cIdx++) {
				const colDef = columnsToRender[cIdx];
				const hasRightDivider = cIdx < columnsToRender.length - 1;
				const col = createColumn(colDef.name, colDef.isFill, colDef.width, hasRightDivider);
				for (let i = 0; i < parsedRows.length; i++) {
					const row = parsedRows[i];
					const isLast = i === parsedRows.length - 1;
					if (colDef.type === "TYPE") {
						const cell = createCell(row.typeName, colDef.width, isLast, "MIN", rowFills[i]);
						if (row.typeText) {
							row.typeText.name = row.typeName;
							try {
								row.typeText.visible = true;
							} catch (_unused7) {}
							cell.appendChild(row.typeText);
							adoptedTextIds.add(row.typeText.id);
						}
						col.appendChild(cell);
					} else if (colDef.type === "NAME") {
						const cell = createCell(row.fieldName, colDef.width, isLast, "MIN", rowFills[i]);
						if (row.nameText) {
							row.nameText.name = row.fieldName;
							try {
								row.nameText.visible = true;
							} catch (_unused8) {}
							cell.appendChild(row.nameText);
							adoptedTextIds.add(row.nameText.id);
						}
						col.appendChild(cell);
					} else if (colDef.type === "KEY") {
						const cell = createCell("Key", colDef.width, isLast, "CENTER", rowFills[i]);
						if (row.badges.length > 0) for (const badgeText of row.badges) {
							badgeText.name = badgeText.characters.trim();
							try {
								badgeText.visible = true;
							} catch (_unused9) {}
							cell.appendChild(badgeText);
							adoptedTextIds.add(badgeText.id);
						}
						col.appendChild(cell);
					} else if (colDef.type === "COMMENT") {
						const cell = createCell("Comment", colDef.width, isLast, "MIN", rowFills[i]);
						if (row.commentTexts.length > 0) for (const ct of row.commentTexts) {
							ct.name = ct.characters.trim();
							try {
								ct.visible = true;
							} catch (_unused10) {}
							cell.appendChild(ct);
							adoptedTextIds.add(ct.id);
						}
						col.appendChild(cell);
					}
				}
				contentFrame.appendChild(col);
			}
			tableCard.appendChild(contentFrame);
			const unadoptedTexts = texts.filter((t) => !adoptedTextIds.has(t.id) && !t.removed);
			if (unadoptedTexts.length > 0) {
				const fallbackRow = figma.createFrame();
				fallbackRow.name = "Row: Additional Details";
				fallbackRow.layoutMode = "HORIZONTAL";
				fallbackRow.layoutAlign = "STRETCH";
				fallbackRow.primaryAxisSizingMode = "FIXED";
				fallbackRow.counterAxisSizingMode = "AUTO";
				fallbackRow.resize(tableWidth, 34);
				fallbackRow.paddingLeft = 14;
				fallbackRow.paddingRight = 14;
				fallbackRow.paddingTop = 8;
				fallbackRow.paddingBottom = 8;
				fallbackRow.itemSpacing = 8;
				fallbackRow.fills = cardBgFill;
				for (const ut of unadoptedTexts) {
					ut.name = `Extra: ${ut.characters.trim()}`;
					fallbackRow.appendChild(ut);
					adoptedTextIds.add(ut.id);
				}
				tableCard.appendChild(fallbackRow);
				tableCard.primaryAxisSizingMode = "AUTO";
			}
			const parent = entity.parent;
			if (parent && !entity.removed) {
				parent.appendChild(tableCard);
				try {
					entity.remove();
				} catch (_unused11) {}
			}
		}
	}
	//#endregion
	//#region plugin/src/cleanup.ts
	/** Pass 1: safe purge of empty text nodes, empty groups and zero-size vectors. */
	function purgeJunkNodes(n) {
		if (!n || n.removed) return;
		if ("children" in n) try {
			const children = [...n.children];
			for (const child of children) if (child && !child.removed) purgeJunkNodes(child);
		} catch (_unused) {}
		if (n.removed) return;
		if (n.type === "TEXT") {
			if ((n.characters || "").trim().length === 0) try {
				n.remove();
			} catch (_unused2) {}
		} else if (n.type === "VECTOR") {
			if (Math.round(n.width) === 0 && Math.round(n.height) === 0) try {
				n.remove();
			} catch (_unused3) {}
		} else if (n.type === "GROUP") try {
			if ("children" in n && n.children.length === 0) n.remove();
		} catch (_unused4) {}
	}
	/** Pass 4: dissolve redundant single-child wrapper groups (preserving named nodes & inlined markers). */
	function dissolveRedundantWrappers(parent) {
		if (!parent || parent.removed || !("children" in parent)) return;
		for (const child of [...parent.children]) if (child && !child.removed && "children" in child) dissolveRedundantWrappers(child);
		for (const child of [...parent.children]) {
			if (!child || child.removed) continue;
			if (child.type === "GROUP" && "children" in child) {
				if (child.children.length === 0) {
					try {
						child.remove();
					} catch (_unused5) {}
					continue;
				}
				const name = (child.name || "").toLowerCase();
				const isGeneric = name === "group" || name === "" || name === "label" || name.startsWith("root-") || name === "edgepath" || name === "edgelabel";
				const isSingleChild = child.children.length === 1;
				const isProtectedNode = name.includes("flowchart-") || name.includes("entity-") || name.includes("actor") || name.includes("subgraph") || name.includes("cluster") || name.includes("inlined-marker") || name.includes("marker");
				if ((isGeneric || isSingleChild) && !isProtectedNode) {
					const childIndex = parent.children.indexOf(child);
					const grandChildren = [...child.children];
					for (let i = 0; i < grandChildren.length; i++) {
						const gc = grandChildren[i];
						if (childIndex !== -1 && typeof parent.insertChild === "function") parent.insertChild(childIndex + i, gc);
						else parent.appendChild(gc);
					}
					try {
						child.remove();
					} catch (_unused6) {}
				}
			}
		}
	}
	/** Run dissolution passes to flatten deeply nested wrapper hierarchies while preserving layer order. */
	function flattenWrappers(rootNode) {
		for (let pass = 0; pass < 5; pass++) {
			dissolveRedundantWrappers(rootNode);
			purgeJunkNodes(rootNode);
		}
	}
	/** Pass 4b: ensure sequence number text layers are never occluded by badge vector circles. */
	function elevateSequenceNumbers(parent) {
		if (!parent || parent.removed || !("children" in parent)) return;
		for (const child of [...parent.children]) if (child && !child.removed && "children" in child) elevateSequenceNumbers(child);
		for (const child of [...parent.children]) if (child && !child.removed && child.type === "TEXT") {
			const text = (child.characters || "").trim();
			if (/^[0-9]{1,3}$/.test(text) && child.width <= 24 && child.height <= 24) try {
				parent.appendChild(child);
			} catch (_unused7) {}
		}
	}
	/** If root frame has only 1 group child, unwrap it into the root frame directly. */
	function unwrapRootGroup(rootNode) {
		if (rootNode.type === "FRAME" && rootNode.children && rootNode.children.length === 1 && rootNode.children[0].type === "GROUP") {
			const singleGroup = rootNode.children[0];
			for (const c of [...singleGroup.children]) rootNode.appendChild(c);
			try {
				singleGroup.remove();
			} catch (_unused8) {}
		}
	}
	/** Pass 5: final sweep to clean remaining layer names and label connectors & markers. */
	function finalClean(n) {
		if (!n || n.removed) return;
		if ((n.name || "").toLowerCase().includes("inlined-marker")) n.name = markerLayerName(n.name);
		else if (n.type === "TEXT") {
			const preview = (n.characters || "").trim().replace(/\s+/g, " ");
			if (!n.name || n.name === "Text" || n.name === "Group") n.name = preview.length > 28 ? preview.slice(0, 28) + "..." : preview;
		} else if (n.type === "VECTOR") {
			if (!n.name || n.name === "Vector") {
				const parentName = (n.parent && n.parent.name ? n.parent.name : "").toLowerCase();
				if (isShapeLayerName(parentName)) n.name = "Shape";
				else if (isConnectorLayerName(parentName)) n.name = "Connector";
			}
		} else if ("children" in n && !n.removed) try {
			for (const child of [...n.children]) if (child && !child.removed) finalClean(child);
		} catch (_unused9) {}
	}
	/** Per-diagram-type steps, executed in order between the initial purge and the generic cleanup. */
	var DIAGRAM_STEPS = [{
		name: "erd",
		run: (rootNode, themeVariables) => convertErdTables(rootNode, themeVariables)
	}];
	function optimizeDiagramNodes(rootNode, themeVariables) {
		purgeJunkNodes(rootNode);
		for (const step of DIAGRAM_STEPS) step.run(rootNode, themeVariables);
		flattenWrappers(rootNode);
		elevateSequenceNumbers(rootNode);
		unwrapRootGroup(rootNode);
		finalClean(rootNode);
	}
	//#endregion
	//#region plugin/src/main.ts
	figma.showUI(__html__, {
		width: 500,
		height: 680,
		themeColors: true
	});
	figma.ui.onmessage = async (msg) => {
		if (msg.type === "create-svg" && msg.svg) try {
			try {
				await Promise.all([
					figma.loadFontAsync({
						family: "Inter",
						style: "Regular"
					}),
					figma.loadFontAsync({
						family: "Inter",
						style: "Medium"
					}),
					figma.loadFontAsync({
						family: "Inter",
						style: "Bold"
					}),
					figma.loadFontAsync({
						family: "Arial",
						style: "Regular"
					}),
					figma.loadFontAsync({
						family: "Arial",
						style: "Bold"
					})
				]);
			} catch (fontErr) {}
			const processedSvg = prepareSvgForFigma(msg.svg);
			const node = figma.createNodeFromSvg(processedSvg);
			node.name = msg.name || "Mermapix Diagram";
			function ensureAllLayersVisible(n) {
				if (!n || n.removed) return;
				try {
					n.visible = true;
				} catch (_unused) {}
				if ("children" in n && Array.isArray(n.children)) for (const child of n.children) ensureAllLayersVisible(child);
			}
			ensureAllLayersVisible(node);
			figma.currentPage.appendChild(node);
			optimizeDiagramNodes(node, msg.themeVariables);
			ensureAllLayersVisible(node);
			const center = figma.viewport.center;
			node.x = Math.round(center.x - node.width / 2);
			node.y = Math.round(center.y - node.height / 2);
			figma.currentPage.selection = [node];
			figma.viewport.scrollAndZoomIntoView([node]);
			figma.notify("✓ Mermapix diagram added to canvas with clean Auto Layout layers!");
		} catch (err) {
			figma.notify("Failed to create diagram: " + (err instanceof Error ? err.message : String(err)), { error: true });
		}
		else if (msg.type === "resize" && msg.width && msg.height) figma.ui.resize(Math.round(msg.width), Math.round(msg.height));
		else if (msg.type === "close") figma.closePlugin();
	};
	//#endregion
})();
