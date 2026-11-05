// ERD (entityRelationshipDiagram) conversion:
// detects entity table groups and rebuilds each one as a native Auto Layout table
// (vertical card -> header frame + horizontal "Content" of vertical column frames).

import { isErdEntityName } from './naming.ts'
import { collectEntityVectors, extractErdPaints } from './erdPaints.ts'
import { computeColumnWidths } from './erdLayout.ts'

/**
 * Converts ERD table/entity groups into native Column-Based Auto Layout Frames
 * (modeled after user reference table 13:1284 "Content"):
 *  - Main Table Card: Vertical Auto Layout, border stroke.
 *  - Header: Horizontal Auto Layout with table name and bottom border separator.
 *  - Content: Horizontal Auto Layout container holding vertical Column frames
 *    (Type | Field Name | Key | Comment), every cell uniform height with bottom border.
 */
export function convertErdTables(rootNode: any, themeVariables?: Record<string, any>): void {
  // Pass 2: Identify entity table groups.
  // Entity = GROUP named `<svgId>-entity-<Name>-<index>` (exact match, decided BEFORE any skip
  // rule so table names containing edge/label/marker words are never skipped). Relationship
  // edges (`id_entity`) and self-relationship pieces (`cyclic-special`) are not entities.
  const entityContainers: any[] = []
  function findEntities(n: any): void {
    if (!n || n.removed) return

    if (n.type === 'GROUP' && isErdEntityName(n.name)) {
      entityContainers.push(n)
      return
    }

    const name = (n.name || '').toLowerCase()
    if (name.includes('id_entity') || name.includes('cyclic-special') || name.includes('inlined-marker')) {
      return
    }

    if ('children' in n && !n.removed) {
      try {
        for (const child of [...n.children]) {
          if (child && !child.removed) findEntities(child)
        }
      } catch {}
    }
  }
  findEntities(rootNode)

  // Pass 3: Convert each entity box into a native Column-Based Auto Layout Frame
  for (const entity of entityContainers) {
    if (!entity || entity.removed) continue

    // Collect all valid text nodes inside entity
    const texts: any[] = []
    function scanEntityTexts(n: any) {
      if (!n || n.removed) return
      if (n.type === 'TEXT') {
        if ((n.characters || '').trim().length > 0) texts.push(n)
      } else if ('children' in n && !n.removed) {
        try {
          for (const child of [...n.children]) {
            if (child && !child.removed) scanEntityTexts(child)
          }
        } catch {}
      }
    }
    scanEntityTexts(entity)

    if (texts.length === 0) continue

    // Cluster text nodes by Y position (12px tolerance) into rows
    texts.sort((a, b) => a.y - b.y)
    const rows: any[][] = []
    let currentRow: any[] = []
    let currentY: number | null = null

    for (const t of texts) {
      if (currentY === null || Math.abs(t.y - currentY) > 12) {
        if (currentRow.length > 0) rows.push(currentRow)
        currentRow = [t]
        currentY = t.y
      } else {
        currentRow.push(t)
      }
    }
    if (currentRow.length > 0) rows.push(currentRow)

    // Sort texts within each row by X coordinate (left to right)
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
    }

    const headerTexts = rows[0] || []
    const tableName = headerTexts.map((t: any) => t.characters.trim()).join(' ') || 'Entity'
    const columnRows = rows.slice(1)

    // Sets the final font/size and lets the text box re-measure itself to the new font.
    function applyFont(t: any, style: string, size: number): void {
      try {
        t.fontName = { family: 'Inter', style }
        t.fontSize = size
      } catch {}
      try {
        t.textAutoResize = 'WIDTH_AND_HEIGHT'
      } catch {}
    }

    // Track every single text node to guarantee 100% zero-drop
    const adoptedTextIds = new Set<string>()

    // Parse each row into: typeText, nameText, badges[], commentTexts[]
    let maxTypeWidth = 0
    let maxNameWidth = 0
    let maxBadgeWidth = 0
    let maxCommentWidth = 0
    let hasType = false
    let hasBadges = false
    let hasComments = false

    interface ParsedRow {
      typeText: any | null
      nameText: any | null
      badges: any[]
      commentTexts: any[]
      typeName: string
      fieldName: string
      badgeNames: string[]
      commentStr: string
    }

    const parsedRows: ParsedRow[] = []

    for (const rowTexts of columnRows) {
      const badges: any[] = []
      const contentTexts: any[] = []

      for (const t of rowTexts) {
        const char = (t.characters || '').trim()
        if (/^(PK|FK|UK|PK,\s*FK|FK,\s*UK|PK\s*FK|NULL|NOT NULL)$/i.test(char)) {
          badges.push(t)
        } else {
          contentTexts.push(t)
        }
      }

      let typeText: any | null = null
      let nameText: any | null = null
      let commentTexts: any[] = []

      if (contentTexts.length === 1) {
        nameText = contentTexts[0]
      } else if (contentTexts.length === 2) {
        typeText = contentTexts[0]
        nameText = contentTexts[1]
      } else if (contentTexts.length >= 3) {
        typeText = contentTexts[0]
        nameText = contentTexts[1]
        commentTexts = contentTexts.slice(2)
      }

      // Assign the final font BEFORE measuring: Inter is wider than the imported Arial,
      // so widths measured earlier would make cells too narrow.
      if (typeText) applyFont(typeText, 'Regular', 12)
      if (nameText) applyFont(nameText, 'Regular', 12)
      for (const b of badges) applyFont(b, 'Bold', 12)
      for (const c of commentTexts) applyFont(c, 'Regular', 12)

      if (typeText) {
        hasType = true
        maxTypeWidth = Math.max(maxTypeWidth, Math.ceil(typeText.width))
      }
      if (nameText) {
        maxNameWidth = Math.max(maxNameWidth, Math.ceil(nameText.width))
      }
      if (badges.length > 0) {
        hasBadges = true
        // Cell itemSpacing between badges is 4px
        const rowBadgeWidth = badges.reduce((sum, b) => sum + Math.ceil(b.width), 0) + 4 * (badges.length - 1)
        maxBadgeWidth = Math.max(maxBadgeWidth, rowBadgeWidth)
      }
      if (commentTexts.length > 0) {
        hasComments = true
        const rowCommentWidth = commentTexts.reduce((sum, c) => sum + Math.ceil(c.width), 0) + 4 * (commentTexts.length - 1)
        maxCommentWidth = Math.max(maxCommentWidth, rowCommentWidth)
      }

      parsedRows.push({
        typeText,
        nameText,
        badges,
        commentTexts,
        typeName: typeText ? typeText.characters.trim() : '',
        fieldName: nameText ? nameText.characters.trim() : '',
        badgeNames: badges.map((b: any) => b.characters.trim()),
        commentStr: commentTexts.map((c: any) => c.characters.trim()).join(' ')
      })
    }

    // 100% Geometric Precision:
    // Mermaid connector lines terminate at the entity's outer bounding box:
    // x = entity.x, y = entity.y, width = entity.width, height = entity.height.
    const origEntityWidth = entity.width || 200
    const origEntityHeight = entity.height || 120
    const origEntityX = entity.x
    const origEntityY = entity.y

    const tableWidth = origEntityWidth
    const tableX = origEntityX
    const tableY = origEntityY

    // Content-aware column widths: each column fits its widest (post-font) content plus cell
    // padding; widths sum to tableWidth (Mermaid's entity width) so connectors stay attached.
    const colWidths = computeColumnWidths(tableWidth, {
      type: maxTypeWidth,
      name: maxNameWidth,
      key: maxBadgeWidth,
      comment: maxCommentWidth,
      hasType,
      hasKey: hasBadges,
      hasComment: hasComments,
    })
    const typeColWidth = colWidths.type
    const badgeColWidth = colWidths.key
    const commentColWidth = colWidths.comment
    const nameColInitialWidth = colWidths.name

    // Paints: header <- outer box fill, row i <- row pair i fill, border <- outline stroke.
    // Falls back to Mermaid theme tokens per part only when extraction fails.
    const paints = extractErdPaints(collectEntityVectors(entity), parsedRows.length, themeVariables)
    const headerBgFill = paints.headerFill
    const cardBgFill = headerBgFill
    const tableBorder = paints.border
    const rowFills = paints.rowFills

    // In Mermaid ERD, all rows (header + attribute rows) divide entity.height evenly:
    const totalRowCount = parsedRows.length > 0 ? parsedRows.length + 1 : 1
    const cellHeight = parsedRows.length > 0 ? origEntityHeight / totalRowCount : 0
    const headerHeight = origEntityHeight - cellHeight * parsedRows.length

    // 1. Create Table Card Frame (Vertical Auto Layout: FIXED width and FIXED height matching Mermaid 1:1)
    const tableCard = figma.createFrame()
    tableCard.name = tableName
    tableCard.x = tableX
    tableCard.y = tableY
    tableCard.layoutMode = 'VERTICAL'
    tableCard.primaryAxisSizingMode = 'FIXED' // FIXED height = origEntityHeight
    tableCard.counterAxisSizingMode = 'FIXED' // FIXED width = origEntityWidth
    tableCard.resize(tableWidth, origEntityHeight)
    tableCard.itemSpacing = 0
    tableCard.paddingTop = 0
    tableCard.paddingBottom = 0
    tableCard.paddingLeft = 0
    tableCard.paddingRight = 0
    tableCard.cornerRadius = 0 // Mermaid ERD tables use crisp rectangular borders
    tableCard.fills = cardBgFill
    tableCard.strokes = tableBorder
    tableCard.strokeWeight = 1
    tableCard.strokeAlign = 'INSIDE'
    tableCard.clipsContent = true

    // 2. Create Header Frame (Table Title) - centered 1:1 with Mermaid
    const headerFrame = figma.createFrame()
    headerFrame.name = `Header: ${tableName}`
    headerFrame.layoutMode = 'HORIZONTAL'
    headerFrame.layoutAlign = 'STRETCH' // FILL parent width
    headerFrame.primaryAxisSizingMode = 'FIXED'
    headerFrame.counterAxisSizingMode = 'FIXED'
    headerFrame.resize(tableWidth, headerHeight)
    headerFrame.paddingTop = 0
    headerFrame.paddingBottom = 0
    headerFrame.paddingLeft = 8
    headerFrame.paddingRight = 8
    headerFrame.primaryAxisAlignItems = 'CENTER' // Mermaid centers entity name
    headerFrame.counterAxisAlignItems = 'CENTER'
    headerFrame.itemSpacing = 8
    headerFrame.fills = headerBgFill
    if (tableBorder.length > 0) {
      headerFrame.strokes = tableBorder
      headerFrame.strokeBottomWeight = 1
      headerFrame.strokeTopWeight = 0
      headerFrame.strokeLeftWeight = 0
      headerFrame.strokeRightWeight = 0
      headerFrame.strokeAlign = 'INSIDE'
    } else {
      headerFrame.strokes = []
    }

    for (const ht of headerTexts) {
      ht.name = `Title: ${ht.characters.trim()}`
      try {
        ht.fontName = { family: 'Inter', style: 'Bold' }
        ht.fontSize = 13
      } catch {}
      try {
        ht.visible = true
      } catch {}
      // Keep ht.fills untouched so exact color from Mermaid SVG is preserved!
      headerFrame.appendChild(ht)
      adoptedTextIds.add(ht.id)
    }
    tableCard.appendChild(headerFrame)

    // 3. Create Content Frame (Horizontal Columns Container)
    const contentFrame = figma.createFrame()
    contentFrame.name = 'Content'
    contentFrame.layoutMode = 'HORIZONTAL'
    contentFrame.layoutAlign = 'STRETCH'
    contentFrame.primaryAxisSizingMode = 'FIXED'
    contentFrame.counterAxisSizingMode = 'FIXED'
    contentFrame.resize(tableWidth, cellHeight * parsedRows.length)
    contentFrame.itemSpacing = 0
    contentFrame.paddingTop = 0
    contentFrame.paddingBottom = 0
    contentFrame.paddingLeft = 0
    contentFrame.paddingRight = 0
    contentFrame.fills = []
    contentFrame.strokes = []

    // Helper: Create Column Frame
    function createColumn(name: string, isFillWidth: boolean, initialWidth: number, hasRightDivider: boolean): any {
      const col = figma.createFrame()
      col.name = `Column: ${name}`
      col.layoutMode = 'VERTICAL'
      col.layoutAlign = 'STRETCH'
      col.primaryAxisSizingMode = 'FIXED'
      col.counterAxisSizingMode = isFillWidth ? 'AUTO' : 'FIXED'
      col.resize(initialWidth, cellHeight * parsedRows.length)
      if (isFillWidth) {
        col.layoutGrow = 1 // FILL width
      } else {
        col.layoutGrow = 0
      }
      col.itemSpacing = 0
      col.paddingTop = 0
      col.paddingBottom = 0
      col.paddingLeft = 0
      col.paddingRight = 0
      col.fills = []
      if (hasRightDivider && tableBorder.length > 0) {
        col.strokes = tableBorder
        col.strokeRightWeight = 1
        col.strokeTopWeight = 0
        col.strokeBottomWeight = 0
        col.strokeLeftWeight = 0
        col.strokeAlign = 'INSIDE'
      } else {
        col.strokes = []
      }
      return col
    }

    // Helper: Create Base Table Cell
    function createCell(name: string, width: number, isLastRow: boolean, align: 'MIN' | 'CENTER', fills: any[]): any {
      const cell = figma.createFrame()
      cell.name = name ? `Cell: ${name}` : 'Cell'
      cell.layoutMode = 'HORIZONTAL'
      cell.layoutAlign = 'STRETCH'
      cell.primaryAxisSizingMode = 'FIXED'
      cell.counterAxisSizingMode = 'FIXED'
      cell.resize(width, cellHeight)
      cell.paddingLeft = 8
      cell.paddingRight = 8
      cell.paddingTop = 0
      cell.paddingBottom = 0
      cell.primaryAxisAlignItems = align
      cell.counterAxisAlignItems = 'CENTER'
      cell.itemSpacing = 4
      cell.fills = fills
      if (!isLastRow && tableBorder.length > 0) {
        cell.strokes = tableBorder
        cell.strokeBottomWeight = 1
        cell.strokeTopWeight = 0
        cell.strokeLeftWeight = 0
        cell.strokeRightWeight = 0
        cell.strokeAlign = 'INSIDE'
      } else {
        cell.strokes = []
      }
      return cell
    }

    // Define columns in 1:1 Mermaid ERD order: Type | Field Name | Key | Comment
    const columnsToRender: Array<{
      type: 'TYPE' | 'NAME' | 'KEY' | 'COMMENT'
      name: string
      width: number
      isFill: boolean
      align: 'MIN' | 'CENTER'
    }> = []

    if (hasType) {
      columnsToRender.push({ type: 'TYPE', name: 'Type', width: typeColWidth, isFill: false, align: 'MIN' })
    }
    columnsToRender.push({ type: 'NAME', name: 'Field Name', width: nameColInitialWidth, isFill: true, align: 'MIN' })
    if (hasBadges) {
      columnsToRender.push({ type: 'KEY', name: 'Key', width: badgeColWidth, isFill: false, align: 'CENTER' })
    }
    if (hasComments) {
      columnsToRender.push({ type: 'COMMENT', name: 'Comment', width: commentColWidth, isFill: false, align: 'MIN' })
    }

    for (let cIdx = 0; cIdx < columnsToRender.length; cIdx++) {
      const colDef = columnsToRender[cIdx]
      const hasRightDivider = cIdx < columnsToRender.length - 1
      const col = createColumn(colDef.name, colDef.isFill, colDef.width, hasRightDivider)

      for (let i = 0; i < parsedRows.length; i++) {
        const row = parsedRows[i]
        const isLast = i === parsedRows.length - 1

        if (colDef.type === 'TYPE') {
          const cell = createCell(row.typeName, colDef.width, isLast, 'MIN', rowFills[i])
          if (row.typeText) {
            row.typeText.name = row.typeName
            try {
              row.typeText.visible = true
            } catch {}
            // Keep row.typeText.fills untouched!
            cell.appendChild(row.typeText)
            adoptedTextIds.add(row.typeText.id)
          }
          col.appendChild(cell)
        } else if (colDef.type === 'NAME') {
          const cell = createCell(row.fieldName, colDef.width, isLast, 'MIN', rowFills[i])
          if (row.nameText) {
            row.nameText.name = row.fieldName
            try {
              row.nameText.visible = true
            } catch {}
            // Keep row.nameText.fills untouched!
            cell.appendChild(row.nameText)
            adoptedTextIds.add(row.nameText.id)
          }
          col.appendChild(cell)
        } else if (colDef.type === 'KEY') {
          const cell = createCell('Key', colDef.width, isLast, 'CENTER', rowFills[i])
          if (row.badges.length > 0) {
            for (const badgeText of row.badges) {
              badgeText.name = badgeText.characters.trim()
              try {
                badgeText.visible = true
              } catch {}
              // No pill badge frame! Keep badgeText.fills untouched!
              cell.appendChild(badgeText)
              adoptedTextIds.add(badgeText.id)
            }
          }
          col.appendChild(cell)
        } else if (colDef.type === 'COMMENT') {
          const cell = createCell('Comment', colDef.width, isLast, 'MIN', rowFills[i])
          if (row.commentTexts.length > 0) {
            for (const ct of row.commentTexts) {
              ct.name = ct.characters.trim()
              try {
                ct.visible = true
              } catch {}
              // Keep ct.fills untouched!
              cell.appendChild(ct)
              adoptedTextIds.add(ct.id)
            }
          }
          col.appendChild(cell)
        }
      }

      contentFrame.appendChild(col)
    }

    tableCard.appendChild(contentFrame)

    // Zero-drop guarantee: preserve any unadopted text in a fallback row
    const unadoptedTexts = texts.filter((t: any) => !adoptedTextIds.has(t.id) && !t.removed)
    if (unadoptedTexts.length > 0) {
      const fallbackRow = figma.createFrame()
      fallbackRow.name = 'Row: Additional Details'
      fallbackRow.layoutMode = 'HORIZONTAL'
      fallbackRow.layoutAlign = 'STRETCH'
      fallbackRow.primaryAxisSizingMode = 'FIXED'
      fallbackRow.counterAxisSizingMode = 'AUTO'
      fallbackRow.resize(tableWidth, 34)
      fallbackRow.paddingLeft = 14
      fallbackRow.paddingRight = 14
      fallbackRow.paddingTop = 8
      fallbackRow.paddingBottom = 8
      fallbackRow.itemSpacing = 8
      fallbackRow.fills = cardBgFill

      for (const ut of unadoptedTexts) {
        ut.name = `Extra: ${ut.characters.trim()}`
        fallbackRow.appendChild(ut)
        adoptedTextIds.add(ut.id)
      }
      tableCard.appendChild(fallbackRow)
      // The card is FIXED-height; let it grow so the extra row is not clipped/overflowing.
      tableCard.primaryAxisSizingMode = 'AUTO'
    }

    const parent = entity.parent
    if (parent && !entity.removed) {
      parent.appendChild(tableCard)
      try {
        entity.remove()
      } catch {}
    }
  }
}
