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
	var hasFill$1 = (v) => Array.isArray(v.fills) && v.fills.length > 0 && v.fills[0].visible !== false;
	var hasStroke$1 = (v) => Array.isArray(v.strokes) && v.strokes.length > 0 && v.strokes[0].visible !== false;
	var solid = (color) => [{
		type: "SOLID",
		color
	}];
	function extractErdPaints(vectors, rowCount, themeVariables) {
		const fillVectors = vectors.filter(hasFill$1);
		const strokeOnly = vectors.filter((v) => hasStroke$1(v) && !hasFill$1(v));
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
		const borderVector = strokeOnly[0] || vectors.find(hasStroke$1);
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
	//#region plugin/src/shapeGeometry.ts
	var ARG_COUNT = {
		M: 2,
		L: 2,
		H: 1,
		V: 1,
		C: 6,
		Q: 4,
		Z: 0
	};
	/** Parses absolute SVG path data. Returns null for anything outside M L H V C Q Z. */
	function parsePathData(d) {
		if (typeof d !== "string") return null;
		const toks = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
		if (!toks || toks.length === 0) return null;
		const out = [];
		let i = 0;
		while (i < toks.length) {
			const t = toks[i];
			if (!/^[A-Za-z]$/.test(t)) return null;
			const cmd = t;
			const n = ARG_COUNT[cmd];
			if (n === void 0) return null;
			i++;
			if (n === 0) {
				out.push({
					c: cmd,
					p: []
				});
				continue;
			}
			let first = true;
			let any = false;
			while (i < toks.length && !/^[A-Za-z]$/.test(toks[i])) {
				if (i + n > toks.length) return null;
				const p = toks.slice(i, i + n).map(Number);
				if (p.some((v) => !Number.isFinite(v))) return null;
				out.push({
					c: !first && cmd === "M" ? "L" : cmd,
					p
				});
				first = false;
				any = true;
				i += n;
			}
			if (!any) return null;
		}
		return out;
	}
	/** Samples a path into polylines (straight edges every <= 2px, curves adaptively). */
	function flattenPath(cmds) {
		const subpaths = [];
		let cur = null;
		let x = 0;
		let y = 0;
		let sx = 0;
		let sy = 0;
		let curveCount = 0;
		let lineCount = 0;
		const lineTo = (nx, ny) => {
			if (!cur) {
				cur = [{
					x,
					y
				}];
				subpaths.push(cur);
			}
			const len = Math.hypot(nx - x, ny - y);
			const steps = Math.min(400, Math.max(1, Math.ceil(len / 2)));
			for (let s = 1; s <= steps; s++) cur.push({
				x: x + (nx - x) * s / steps,
				y: y + (ny - y) * s / steps
			});
			x = nx;
			y = ny;
		};
		for (const { c, p } of cmds) if (c === "M") {
			x = sx = p[0];
			y = sy = p[1];
			cur = [{
				x,
				y
			}];
			subpaths.push(cur);
		} else if (c === "L") {
			lineCount++;
			lineTo(p[0], p[1]);
		} else if (c === "H") {
			lineCount++;
			lineTo(p[0], y);
		} else if (c === "V") {
			lineCount++;
			lineTo(x, p[0]);
		} else if (c === "C" || c === "Q") {
			curveCount++;
			if (!cur) {
				cur = [{
					x,
					y
				}];
				subpaths.push(cur);
			}
			const chord = Math.hypot((c === "C" ? p[4] : p[2]) - x, (c === "C" ? p[5] : p[3]) - y);
			const steps = Math.min(64, Math.max(8, Math.ceil(chord / 3)));
			for (let s = 1; s <= steps; s++) {
				const t = s / steps;
				const u = 1 - t;
				if (c === "C") cur.push({
					x: u * u * u * x + 3 * u * u * t * p[0] + 3 * u * t * t * p[2] + t * t * t * p[4],
					y: u * u * u * y + 3 * u * u * t * p[1] + 3 * u * t * t * p[3] + t * t * t * p[5]
				});
				else cur.push({
					x: u * u * x + 2 * u * t * p[0] + t * t * p[2],
					y: u * u * y + 2 * u * t * p[1] + t * t * p[3]
				});
			}
			x = c === "C" ? p[4] : p[2];
			y = c === "C" ? p[5] : p[3];
		} else if (c === "Z") {
			if (cur && (x !== sx || y !== sy)) lineTo(sx, sy);
			x = sx;
			y = sy;
			cur = null;
		}
		return {
			subpaths,
			curveCount,
			lineCount
		};
	}
	function polylineLength(pts) {
		let len = 0;
		for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		return len;
	}
	/** Max distance of the sampled points from the outline of a w x h rounded rectangle of radius r. */
	function roundedRectDeviation(pts, w, h, r) {
		const hx = w / 2;
		const hy = h / 2;
		let max = 0;
		for (const p of pts) {
			const qx = Math.abs(p.x - hx) - (hx - r);
			const qy = Math.abs(p.y - hy) - (hy - r);
			const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
			const a = Math.abs(d);
			if (a > max) max = a;
		}
		return max;
	}
	var idealPerimeter = (w, h, r) => 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
	var RR_TOLERANCE = .8;
	/**
	* Fits a single closed outline to a rounded rectangle of the given bounds.
	* Returns the best radius, or null when the outline is not a (rounded) rectangle.
	*/
	function fitRoundedRect(pts, w, h) {
		if (pts.length < 4 || w < 1 || h < 1) return null;
		const rMax = Math.min(w, h) / 2;
		const len = polylineLength(pts);
		const dev = (r) => roundedRectDeviation(pts, w, h, r);
		let bestR = 0;
		let bestD = Infinity;
		for (let r = 0; r <= rMax + 1e-9; r += .5) {
			const d = dev(Math.min(r, rMax));
			if (d < bestD) {
				bestD = d;
				bestR = Math.min(r, rMax);
			}
		}
		const dEnd = dev(rMax);
		if (dEnd <= bestD) {
			bestD = dEnd;
			bestR = rMax;
		}
		const lo = Math.max(0, bestR - .5);
		const hi = Math.min(rMax, bestR + .5);
		for (let r = lo; r <= hi + 1e-9; r += .05) {
			const d = dev(Math.min(r, rMax));
			if (d < bestD) {
				bestD = d;
				bestR = Math.min(r, rMax);
			}
		}
		if (bestD > RR_TOLERANCE) return null;
		const ideal = idealPerimeter(w, h, bestR);
		if (Math.abs(len - ideal) > Math.max(2.5, ideal * .03)) return null;
		return bestR;
	}
	var near = (a, b, tol) => Math.abs(a - b) <= tol;
	/** Corner points of a polyline-only path (M/L/H/V/Z), consecutive duplicates and closing point removed. */
	function polygonVertices(cmds) {
		const polys = [];
		let cur = null;
		let x = 0;
		let y = 0;
		const push = (nx, ny) => {
			x = nx;
			y = ny;
			if (!cur) {
				cur = [];
				polys.push(cur);
			}
			const last = cur[cur.length - 1];
			if (!last || !near(last.x, nx, .01) || !near(last.y, ny, .01)) cur.push({
				x: nx,
				y: ny
			});
		};
		for (const { c, p } of cmds) if (c === "M") {
			cur = null;
			push(p[0], p[1]);
		} else if (c === "L") push(p[0], p[1]);
		else if (c === "H") push(p[0], y);
		else if (c === "V") push(x, p[0]);
		for (const poly of polys) if (poly.length > 1) {
			const a = poly[0];
			const b = poly[poly.length - 1];
			if (near(a.x, b.x, .01) && near(a.y, b.y, .01)) poly.pop();
		}
		return polys;
	}
	/** Douglas-Peucker simplification of a closed outline (splits at the two farthest-apart samples). */
	function simplifyClosed(pts, eps) {
		if (pts.length < 4) return pts;
		const open = pts.slice();
		const first = open[0];
		const last = open[open.length - 1];
		if (near(first.x, last.x, .01) && near(first.y, last.y, .01)) open.pop();
		let far = 0;
		let best = -1;
		open.forEach((p, i) => {
			const d = Math.hypot(p.x - open[0].x, p.y - open[0].y);
			if (d > best) {
				best = d;
				far = i;
			}
		});
		const dp = (seg) => {
			if (seg.length < 3) return seg;
			const a = seg[0];
			const b = seg[seg.length - 1];
			const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
			let idx = -1;
			let max = 0;
			for (let i = 1; i < seg.length - 1; i++) {
				const d = Math.abs((b.x - a.x) * (a.y - seg[i].y) - (a.x - seg[i].x) * (b.y - a.y)) / len;
				if (d > max) {
					max = d;
					idx = i;
				}
			}
			if (max <= eps) return [a, b];
			return dp(seg.slice(0, idx + 1)).slice(0, -1).concat(dp(seg.slice(idx)));
		};
		const left = dp(open.slice(0, far + 1));
		const right = dp(open.slice(far).concat([open[0]]));
		return left.slice(0, -1).concat(right.slice(0, -1));
	}
	/** True when the outline follows an axis-aligned ellipse inscribed in the w x h bounds. */
	function isEllipseOutline(pts, w, h) {
		const a = w / 2;
		const b = h / 2;
		if (a < 1 || b < 1) return false;
		return pts.every((p) => Math.abs(Math.hypot((p.x - a) / a, (p.y - b) / b) - 1) <= .04);
	}
	function classifyPolygon(poly, w, h) {
		const tol = Math.max(1, Math.min(w, h) * .02);
		const n = poly.length;
		if (n === 4) {
			if ([
				{
					x: w / 2,
					y: 0
				},
				{
					x: w,
					y: h / 2
				},
				{
					x: w / 2,
					y: h
				},
				{
					x: 0,
					y: h / 2
				}
			].every((m) => poly.some((p) => near(p.x, m.x, tol) && near(p.y, m.y, tol)))) return "Diamond";
			if ([...new Set(poly.map((p) => Math.round(p.y / tol)))].length === 2) {
				const top = poly.filter((p) => near(p.y, 0, tol)).map((p) => p.x).sort((a, b) => a - b);
				const bottom = poly.filter((p) => near(p.y, h, tol)).map((p) => p.x).sort((a, b) => a - b);
				if (top.length === 2 && bottom.length === 2) {
					const topW = top[1] - top[0];
					const botW = bottom[1] - bottom[0];
					if (near(topW, botW, tol) && !near(top[0], bottom[0], tol)) return "Parallelogram";
					if (!near(topW, botW, tol)) return "Trapezoid";
				}
			}
			return "Polygon";
		}
		if (n === 6) return "Hexagon";
		if (n === 5) return "Flag";
		return "Polygon";
	}
	/**
	* Classifies a shape from its vector path data and bounds.
	*  - rect / rounded rect / stadium / circle  -> rectLike (Auto Layout frame with corner radius)
	*  - everything else                         -> complex (wrapper frame around the vector)
	*/
	function classifyShape(data, width, height) {
		const complex = (kind) => ({
			kind,
			rectLike: false,
			cornerRadius: 0
		});
		const cmds = parsePathData(data);
		if (!cmds || width < 1 || height < 1) return complex("Shape");
		const flat = flattenPath(cmds);
		if (flat.subpaths.length === 1) {
			const r = fitRoundedRect(flat.subpaths[0], width, height);
			if (r !== null) {
				const rMax = Math.min(width, height) / 2;
				if (r <= .3) return {
					kind: "Rectangle",
					rectLike: true,
					cornerRadius: 0
				};
				if (r >= rMax - .6) return {
					kind: near(width, height, .6) ? "Circle" : "Stadium",
					rectLike: true,
					cornerRadius: rMax
				};
				return {
					kind: "Rounded Rectangle",
					rectLike: true,
					cornerRadius: Math.round(r * 100) / 100
				};
			}
		}
		if (flat.curveCount === 0) {
			const polys = polygonVertices(cmds);
			if (polys.length === 1) {
				const poly = polys[0];
				if (poly.every((p, i) => {
					const q = poly[(i + 1) % poly.length];
					return near(p.x, q.x, .01) || near(p.y, q.y, .01);
				}) && poly.length > 4) return complex("Subroutine");
				return complex(classifyPolygon(poly, width, height));
			}
			return complex(polys.length > 1 && polys.every((p) => p.length === 4) ? "Subroutine" : "Shape");
		}
		if (flat.lineCount === 0 && flat.subpaths.length === 1) {
			const outline = flat.subpaths[0];
			if (isEllipseOutline(outline, width, height)) return complex(near(width, height, .6) ? "Circle" : "Ellipse");
			const poly = simplifyClosed(outline, Math.max(1.5, Math.min(width, height) * .04));
			return complex(poly.length <= 8 ? classifyPolygon(poly, width, height) : "Shape");
		}
		const verticalOnly = cmds.every((c, i) => {
			if (c.c !== "L") return true;
			const prev = cmds[i - 1];
			if (!prev || prev.p.length < 2) return false;
			const px = prev.p[prev.p.length - 2];
			return near(c.p[0], px, .5);
		});
		if (flat.lineCount > 0 && verticalOnly) return complex("Cylinder");
		return complex("Shape");
	}
	function sameBounds(a, b, tol = .5) {
		return near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.width, b.width, tol) && near(a.height, b.height, tol);
	}
	/** Groups items with identical bounds (stacked fill/outline duplicates), preserving z-order. */
	function groupStackedBounds(items, tol = .5) {
		const groups = [];
		for (const it of items) {
			const g = groups.find((grp) => sameBounds(grp[0], it, tol));
			if (g) g.push(it);
			else groups.push([it]);
		}
		return groups;
	}
	/** A dash pattern that actually draws gaps (rejects `[]`, `[0,0]` and `[1,0]`). */
	function isRealDash(pattern) {
		if (!Array.isArray(pattern) || pattern.length === 0) return false;
		const seq = pattern.length % 2 === 1 ? pattern.concat(pattern) : pattern;
		let dash = 0;
		let gap = 0;
		seq.forEach((v, i) => {
			if (i % 2 === 0) dash += v;
			else gap += v;
		});
		return dash > 0 && gap > 0;
	}
	/**
	* Decides which vector of a stacked group supplies the fill and which supplies the stroke.
	* Fill: first vector with a fill. Stroke: the fill source if it has a stroke, else the first
	* stroked vector. Dash: the stroke source's dash, otherwise any real dash among stroked vectors,
	* so a dash pattern or weight is never lost by dropping the duplicate.
	*/
	function mergePaints(items) {
		const fillFrom = items.findIndex((v) => v.hasFill);
		let strokeFrom = -1;
		if (fillFrom >= 0 && items[fillFrom].hasStroke) strokeFrom = fillFrom;
		else strokeFrom = items.findIndex((v) => v.hasStroke);
		let dash = [];
		if (strokeFrom >= 0) if (isRealDash(items[strokeFrom].dashPattern)) dash = items[strokeFrom].dashPattern;
		else {
			const other = items.find((v) => v.hasStroke && isRealDash(v.dashPattern));
			if (other) dash = other.dashPattern;
		}
		return {
			fillFrom,
			strokeFrom,
			dash
		};
	}
	/** Inter style for an original font weight (400 Regular, 500 Medium, 600 Semi Bold, 700+ Bold). */
	function interStyleForWeight(weight) {
		const w = typeof weight === "number" && Number.isFinite(weight) ? weight : 400;
		if (w <= 450) return "Regular";
		if (w <= 550) return "Medium";
		if (w <= 650) return "Semi Bold";
		return "Bold";
	}
	/**
	* Auto Layout centers content in the content box, so a vertical offset of the label from the
	* shape center (e.g. Mermaid's cylinders) is reproduced with asymmetric padding.
	* Offsets below `threshold` px are ignored (font metric noise).
	*/
	function offsetToPadding(delta, threshold = 1.5) {
		if (!Number.isFinite(delta) || Math.abs(delta) < threshold) return {
			start: 0,
			end: 0
		};
		return delta > 0 ? {
			start: Math.round(delta * 2 * 100) / 100,
			end: 0
		} : {
			start: 0,
			end: Math.round(-delta * 2 * 100) / 100
		};
	}
	//#endregion
	//#region plugin/src/shapes.ts
	var isLive = (n) => Boolean(n) && !n.removed;
	var hasFill = (v) => Array.isArray(v.fills) && v.fills.length > 0 && v.fills[0].visible !== false && v.fills[0].opacity !== 0;
	var hasStroke = (v) => Array.isArray(v.strokes) && v.strokes.length > 0 && v.strokes[0].visible !== false && v.strokes[0].opacity !== 0 && Number(v.strokeWeight) > 0;
	/** Origin of the coordinate space children of `parent` live in (GROUPs are transparent). */
	function childOrigin(parent) {
		if (!parent) return {
			x: 0,
			y: 0
		};
		if (parent.type === "GROUP") return childOrigin(parent.parent);
		if (parent.type === "FRAME" || parent.type === "COMPONENT" || parent.type === "INSTANCE") {
			const o = childOrigin(parent.parent);
			return {
				x: o.x + (parent.x || 0),
				y: o.y + (parent.y || 0)
			};
		}
		return {
			x: 0,
			y: 0
		};
	}
	/** Converts a position relative to `from`'s coordinate space into `to`'s coordinate space. */
	function rebase(x, y, from, to) {
		const a = childOrigin(from);
		const b = childOrigin(to);
		return {
			x: x + a.x - b.x,
			y: y + a.y - b.y
		};
	}
	/** All VECTOR / non-empty TEXT descendants in z-order; anything else (not a GROUP) lands in `others`. */
	function collectParts(container) {
		const out = {
			vectors: [],
			texts: [],
			others: []
		};
		const visit = (n) => {
			if (!isLive(n) || !("children" in n)) return;
			for (const c of [...n.children]) {
				if (!isLive(c)) continue;
				if (c.type === "VECTOR") out.vectors.push(c);
				else if (c.type === "TEXT") {
					if ((c.characters || "").trim().length > 0) out.texts.push(c);
				} else if (c.type === "GROUP") visit(c);
				else out.others.push(c);
			}
		};
		visit(container);
		return out;
	}
	function cloneAll(arr) {
		try {
			return JSON.parse(JSON.stringify(arr));
		} catch (_unused) {
			return arr;
		}
	}
	function pathDataOf(v) {
		const p = v && Array.isArray(v.vectorPaths) ? v.vectorPaths[0] : null;
		return p && typeof p.data === "string" ? p.data : "";
	}
	function labelOf(texts) {
		const s = texts.map((t) => (t.characters || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
		return s.length > 60 ? s.slice(0, 57) + "..." : s;
	}
	/**
	* Switches a shape label from the imported Arial to Inter (weight mapped from the original),
	* keeps size and color, centers it and lets Figma re-measure the box.
	*/
	function styleShapeText(t) {
		const style = interStyleForWeight(typeof t.fontWeight === "number" ? t.fontWeight : t.fontName && /bold/i.test(t.fontName.style || "") ? 700 : 400);
		try {
			t.fontName = {
				family: "Inter",
				style
			};
		} catch (_unused2) {
			try {
				t.fontName = {
					family: "Inter",
					style: "Regular"
				};
			} catch (_unused3) {}
		}
		try {
			t.textAlignHorizontal = "CENTER";
		} catch (_unused4) {}
		try {
			t.textAlignVertical = "CENTER";
		} catch (_unused5) {}
		try {
			t.textAutoResize = "WIDTH_AND_HEIGHT";
		} catch (_unused6) {}
		try {
			t.visible = true;
		} catch (_unused7) {}
		const label = (t.characters || "").trim().replace(/\s+/g, " ");
		t.name = label.length > 28 ? label.slice(0, 28) + "..." : label;
	}
	/** Fixed-size, center/center Auto Layout frame without paint (caller sets fills/strokes). */
	function createCenteredFrame(spec) {
		const f = figma.createFrame();
		f.name = spec.name;
		f.layoutMode = "HORIZONTAL";
		f.primaryAxisSizingMode = "FIXED";
		f.counterAxisSizingMode = "FIXED";
		f.primaryAxisAlignItems = "CENTER";
		f.counterAxisAlignItems = "CENTER";
		f.itemSpacing = 0;
		f.paddingLeft = 0;
		f.paddingRight = 0;
		f.paddingTop = spec.paddingTop || 0;
		f.paddingBottom = spec.paddingBottom || 0;
		f.resize(spec.width, spec.height);
		f.x = spec.x;
		f.y = spec.y;
		f.fills = [];
		f.strokes = [];
		f.clipsContent = false;
		return f;
	}
	function applyStroke(frame, src, dash) {
		frame.strokes = src.strokes;
		frame.strokeWeight = src.strokeWeight;
		frame.strokeAlign = src.strokeAlign || "CENTER";
		if (isRealDash(dash)) frame.dashPattern = dash;
	}
	function tag(frame, key, value) {
		if (value && typeof frame.setPluginData === "function") try {
			frame.setPluginData(key, value);
		} catch (_unused8) {}
	}
	/** Replaces `vector` + `text` (pill / badge style) by one Auto Layout frame carrying the vector's paint. */
	function convertVectorWithLabel(vector, text, name, cls, extraTag) {
		const parent = vector.parent;
		const index = parent.children.indexOf(vector);
		const w = vector.width;
		const h = vector.height;
		const frame = createCenteredFrame({
			name,
			x: 0,
			y: 0,
			width: w,
			height: h
		});
		parent.insertChild(index, frame);
		frame.x = vector.x;
		frame.y = vector.y;
		frame.fills = hasFill(vector) ? vector.fills : [];
		if (hasStroke(vector)) applyStroke(frame, vector, vector.dashPattern);
		frame.cornerRadius = cls.cornerRadius;
		styleShapeText(text);
		frame.appendChild(text);
		vector.remove();
		tag(frame, "mermapix:kind", extraTag);
		return frame;
	}
	/**
	* Converts one Mermaid node group (shape vector(s) + label text) into a native frame.
	* Returns null (group untouched) when it has no vector, or contains unknown node types.
	*/
	function convertShapeGroup(group, opts = {}) {
		if (!isLive(group) || !group.parent || !("children" in group)) return null;
		const parts = collectParts(group);
		if (parts.vectors.length === 0 || parts.others.length > 0) return null;
		const visuals = groupStackedBounds(parts.vectors).map((vs) => ({
			vectors: vs,
			x: vs[0].x,
			y: vs[0].y,
			width: vs[0].width,
			height: vs[0].height
		}));
		const area = (v) => v.width * v.height;
		const primary = visuals.reduce((a, b) => area(b) > area(a) ? b : a);
		const merged = visuals.map((v) => {
			return {
				visual: v,
				merge: mergePaints(v.vectors.map((vec) => ({
					hasFill: hasFill(vec),
					hasStroke: hasStroke(vec),
					strokeWeight: Number(vec.strokeWeight) || 0,
					dashPattern: Array.isArray(vec.dashPattern) ? vec.dashPattern : []
				})))
			};
		});
		const primaryMerge = merged.find((m) => m.visual === primary);
		const pathSource = primary.vectors[Math.max(0, primaryMerge.merge.fillFrom)];
		let cls = classifyShape(pathDataOf(pathSource), primary.width, primary.height);
		if (visuals.length > 1) cls = {
			kind: visuals.every((v) => classifyShape(pathDataOf(v.vectors[0]), v.width, v.height).kind === "Circle") ? "Double Circle" : cls.kind,
			rectLike: false,
			cornerRadius: 0
		};
		const label = labelOf(parts.texts);
		const parentNode = group.parent;
		const index = parentNode.children.indexOf(group);
		const bx = Math.min(...visuals.map((v) => v.x));
		const by = Math.min(...visuals.map((v) => v.y));
		const bw = Math.max(...visuals.map((v) => v.x + v.width)) - bx;
		const bh = Math.max(...visuals.map((v) => v.y + v.height)) - by;
		const single = parts.texts.length === 1 ? parts.texts[0] : null;
		let padTop = 0;
		let padBottom = 0;
		if (single) {
			const pad = offsetToPadding(single.y + single.height / 2 - (by + bh / 2));
			padTop = Math.min(pad.start, bh);
			padBottom = Math.min(pad.end, bh);
		}
		const groupOrigin = group.parent;
		const frame = createCenteredFrame({
			name: label || "Shape",
			x: 0,
			y: 0,
			width: bw,
			height: bh,
			paddingTop: padTop,
			paddingBottom: padBottom
		});
		parentNode.insertChild(index, frame);
		const pos = rebase(bx, by, groupOrigin, parentNode);
		frame.x = pos.x;
		frame.y = pos.y;
		const kept = [];
		for (const { visual, merge } of merged) {
			const fillSrc = merge.fillFrom >= 0 ? visual.vectors[merge.fillFrom] : null;
			const strokeSrc = merge.strokeFrom >= 0 ? visual.vectors[merge.strokeFrom] : null;
			const base = fillSrc || strokeSrc || visual.vectors[0];
			if (cls.rectLike && visual === primary) {
				frame.fills = fillSrc ? cloneAll(fillSrc.fills) : [];
				if (strokeSrc) applyStroke(frame, strokeSrc, merge.dash);
				frame.cornerRadius = cls.cornerRadius;
			} else {
				base.fills = fillSrc ? cloneAll(fillSrc.fills) : [];
				if (strokeSrc) {
					base.strokes = cloneAll(strokeSrc.strokes);
					base.strokeWeight = strokeSrc.strokeWeight;
					base.strokeAlign = strokeSrc.strokeAlign || "CENTER";
					if (isRealDash(merge.dash)) base.dashPattern = merge.dash;
				} else base.strokes = [];
				kept.push({
					vec: base,
					visual
				});
			}
		}
		for (const { vec, visual } of kept) {
			frame.appendChild(vec);
			try {
				vec.layoutPositioning = "ABSOLUTE";
			} catch (_unused9) {}
			vec.x = visual.x - bx;
			vec.y = visual.y - by;
			try {
				vec.constraints = {
					horizontal: "SCALE",
					vertical: "SCALE"
				};
			} catch (_unused10) {}
			vec.name = cls.kind;
		}
		let textWidth = 0;
		for (const t of parts.texts) if (single) {
			styleShapeText(t);
			frame.appendChild(t);
			textWidth = t.width;
		} else {
			const rel = rebase(t.x, t.y, groupOrigin, frame);
			const rx = rel.x;
			const ry = rel.y;
			frame.appendChild(t);
			try {
				t.layoutPositioning = "ABSOLUTE";
			} catch (_unused11) {}
			t.x = rx;
			t.y = ry;
			textWidth = Math.max(textWidth, t.width);
		}
		for (const v of parts.vectors) if (isLive(v) && v.parent !== frame) try {
			v.remove();
		} catch (_unused12) {}
		try {
			group.remove();
		} catch (_unused13) {}
		tag(frame, "mermapix:kind", cls.kind);
		tag(frame, "mermapix:node", opts.nodeId);
		return {
			frame,
			kind: cls.kind,
			rectLike: cls.rectLike,
			label,
			textOverflow: textWidth > bw + .5,
			textWidth,
			frameWidth: bw
		};
	}
	//#endregion
	//#region plugin/src/flowchart.ts
	var FLOWCHART_NODE_RE = /-flowchart-(.+)-(\d+)$/;
	/** Returns the Mermaid node id when `name` is a flowchart node group name, otherwise null. */
	function flowchartNodeId(name) {
		if (!name || typeof name !== "string") return null;
		if (name.includes("inlined-marker") || name.includes("L_")) return null;
		const m = FLOWCHART_NODE_RE.exec(name);
		return m ? m[1] : null;
	}
	/** Converts every flowchart node group below `rootNode` into a native Auto Layout frame. */
	function convertFlowchartNodes(rootNode) {
		const groups = [];
		const find = (n) => {
			if (!n || n.removed || !("children" in n)) return;
			for (const c of [...n.children]) {
				if (!c || c.removed) continue;
				if (c.type === "GROUP") {
					const nodeId = flowchartNodeId(c.name);
					if (nodeId !== null) {
						groups.push({
							group: c,
							nodeId
						});
						continue;
					}
					find(c);
				}
			}
		};
		find(rootNode);
		const results = [];
		for (const { group, nodeId } of groups) {
			const res = convertShapeGroup(group, { nodeId });
			if (res) results.push(_objectSpread2(_objectSpread2({}, res), {}, { nodeId }));
		}
		return results;
	}
	//#endregion
	//#region plugin/src/edgeLabels.ts
	var SKIP_NAME_RE = /inlined-marker|entity-|flowchart-|L_[A-Za-z0-9]/;
	var hasVisible = (paints) => Array.isArray(paints) && paints.length > 0 && paints[0].visible !== false && paints[0].opacity !== 0;
	/** True when `text` is centered on `vector` (tolerant to Arial vs Inter width differences). */
	function isCenteredLabel(text, vector) {
		const dx = text.x + text.width / 2 - (vector.x + vector.width / 2);
		const dy = text.y + text.height / 2 - (vector.y + vector.height / 2);
		const tolX = Math.max(3, vector.width * .12);
		const tolY = Math.max(3, vector.height * .2);
		const fits = text.width <= vector.width + 6 && text.height <= vector.height + 6;
		return Math.abs(dx) <= tolX && Math.abs(dy) <= tolY && fits;
	}
	function convertEdgeLabels(rootNode) {
		let converted = 0;
		const visit = (n) => {
			if (!n || n.removed || !("children" in n)) return;
			for (const c of [...n.children]) if (c && !c.removed && c.type === "GROUP" && !SKIP_NAME_RE.test(c.name || "")) visit(c);
			if (n.type !== "GROUP") return;
			const kids = [...n.children].filter((c) => c && !c.removed);
			const vectors = kids.filter((c) => c.type === "VECTOR" && c.width >= 1 && c.height >= 1);
			const texts = kids.filter((c) => c.type === "TEXT" && (c.characters || "").trim().length > 0);
			if (vectors.length !== 1 || texts.length !== 1) return;
			const v = vectors[0];
			const t = texts[0];
			if (!hasVisible(v.fills) || hasVisible(v.strokes) && Number(v.strokeWeight) > 0) return;
			if (v.height > 80 || !isCenteredLabel(t, v)) return;
			const cls = classifyShape(Array.isArray(v.vectorPaths) && v.vectorPaths[0] ? v.vectorPaths[0].data : "", v.width, v.height);
			if (!cls.rectLike || cls.kind === "Circle") return;
			convertVectorWithLabel(v, t, `Label: ${labelOf([t])}`, cls, "Edge Label");
			converted++;
		};
		visit(rootNode);
		return converted;
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
	var DIAGRAM_STEPS = [
		{
			name: "erd",
			run: (rootNode, themeVariables) => convertErdTables(rootNode, themeVariables)
		},
		{
			name: "flowchart",
			run: (rootNode) => {
				convertFlowchartNodes(rootNode);
			}
		},
		{
			name: "edge-labels",
			run: (rootNode) => {
				convertEdgeLabels(rootNode);
			}
		}
	];
	/**
	* Figma imports the SVG root as a frame whose white fill is not shown (canvas shows through),
	* while the web preview has the theme background. Paint the theme background so both match.
	*/
	function applyRootBackground(rootNode, themeVariables) {
		const color = parseColorToFigma(themeVariables && themeVariables.background);
		if (!color || !rootNode || rootNode.type !== "FRAME") return;
		try {
			rootNode.fills = [{
				type: "SOLID",
				color,
				opacity: 1,
				visible: true
			}];
		} catch (_unused) {}
	}
	function optimizeDiagramNodes(rootNode, themeVariables) {
		purgeJunkNodes(rootNode);
		for (const step of DIAGRAM_STEPS) step.run(rootNode, themeVariables);
		flattenWrappers(rootNode);
		elevateSequenceNumbers(rootNode);
		unwrapRootGroup(rootNode);
		finalClean(rootNode);
		applyRootBackground(rootNode, themeVariables);
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
					{
						family: "Inter",
						style: "Regular"
					},
					{
						family: "Inter",
						style: "Medium"
					},
					{
						family: "Inter",
						style: "Semi Bold"
					},
					{
						family: "Inter",
						style: "Bold"
					},
					{
						family: "Arial",
						style: "Regular"
					},
					{
						family: "Arial",
						style: "Bold"
					}
				].map((f) => figma.loadFontAsync(f).catch(() => {})));
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
