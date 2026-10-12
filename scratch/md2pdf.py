# -*- coding: utf-8 -*-
# md2pdf.py — render TECHNICAL-REVIEW.md to PDF with Unicode (Arial TTF).
# Tables become real reportlab Tables with wrapping Paragraph cells.
import sys, os, re
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Preformatted,
                                HRFlowable, Table, TableStyle)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('ArialU', r'C:\Windows\Fonts\arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialU-B', r'C:\Windows\Fonts\arialbd.ttf'))

SUP = {'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-'}
GLYPH = {'✅':'[USED]','❌':'[NOT USED]','◐':'[PARTIAL]','■':'','▸':'›','·':'·'}

def inline(t, mono=False):
    t = t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    out, i = [], 0
    while i < len(t):
        ch = t[i]
        if ch in SUP:
            j = i
            while j < len(t) and t[j] in SUP: j += 1
            out.append('<super><font size="6">' + ''.join(SUP[c] for c in t[i:j]) + '</font></super>')
            i = j
        else:
            out.append(GLYPH.get(ch, ch)); i += 1
    t = ''.join(out)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
    if not mono:
        t = re.sub(r'`([^`]+)`', r'<font face="Courier" size="7">\1</font>', t)
    else:
        t = t.replace('`', '')
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1', t)
    return t

h1 = ParagraphStyle('H1', fontName='ArialU-B', fontSize=17, spaceAfter=10, spaceBefore=6, textColor=colors.HexColor('#14365d'))
h2 = ParagraphStyle('H2', fontName='ArialU-B', fontSize=13, spaceBefore=13, spaceAfter=5, textColor=colors.HexColor('#14365d'))
h3 = ParagraphStyle('H3', fontName='ArialU-B', fontSize=10.5, spaceBefore=9, spaceAfter=3, textColor=colors.HexColor('#28527a'))
body = ParagraphStyle('Body', fontName='ArialU', fontSize=9, leading=12.4, spaceAfter=5)
bullet = ParagraphStyle('Bul', parent=body, leftIndent=13, bulletIndent=3)
code = ParagraphStyle('Code', fontName='Courier', fontSize=7.0, leading=8.8,
                      backColor=colors.HexColor('#f4f6f8'), borderPadding=4)
cell = ParagraphStyle('Cell', fontName='ArialU', fontSize=7.4, leading=9.4)
cellh = ParagraphStyle('CellH', parent=cell, fontName='ArialU-B', textColor=colors.white)

def flush_code(buf, story):
    if buf:
        wrapped = []
        for ln in buf:
            while len(ln) > 108:
                wrapped.append(ln[:108]); ln = '    ' + ln[108:]
            wrapped.append(ln)
        story.append(Preformatted('\n'.join(wrapped), code))
        story.append(Spacer(1, 3)); buf.clear()

def flush_table(rows, story):
    if not rows: return
    grid = [[Paragraph(inline(c, mono=(r == 0 and False)), cellh if r == 0 else cell)
             for c in row] for r, row in enumerate(rows)]
    n = max(len(r) for r in rows)
    avail = A4[0] - 3.4 * cm
    t = Table(grid, colWidths=[avail / n] * n, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2c4f7c')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#eef2f6')]),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#c4cdd6')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3), ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    story.append(t); story.append(Spacer(1, 5))
    rows.clear()

def convert(md_path, pdf_path, title):
    story = []
    with open(md_path, encoding='utf-8') as f:
        lines = f.read().splitlines()
    story.append(Paragraph(title, h1))
    story.append(HRFlowable(width='100%', color=colors.HexColor('#14365d')))
    buf, trows, in_code = [], [], False
    for ln in lines:
        s = ln.rstrip('\n')
        if s.strip().startswith('```'):
            if in_code: flush_code(buf, story); in_code = False
            else: flush_table(trows, story); in_code = True
            continue
        if in_code: buf.append(s); continue
        if s.strip().startswith('|'):
            cells = [c.strip() for c in s.strip().strip('|').split('|')]
            if all(re.fullmatch(r':?-{2,}:?', c) for c in cells): continue
            trows.append(cells); continue
        flush_table(trows, story)
        if not s.strip(): flush_code(buf, story); story.append(Spacer(1, 2)); continue
        if s.startswith('####'): story.append(Paragraph(inline(s[4:]), h3))
        elif s.startswith('###'): story.append(Paragraph(inline(s[3:]), h3))
        elif s.startswith('##'): story.append(Paragraph(inline(s[2:]), h2))
        elif s.startswith('#'): story.append(Paragraph(inline(s[1:]), h1))
        elif s.strip() == '---': story.append(HRFlowable(width='30%', color=colors.HexColor('#b9c6d2')))
        elif re.match(r'\s*[-*] ', s):
            story.append(Paragraph(inline(re.sub(r'\s*[-*] ', '', s, count=1)), bullet, bulletText='–'))
        elif s.startswith('>'):
            story.append(Paragraph('<i>' + inline(s.lstrip('> ')) + '</i>',
                ParagraphStyle('Q', parent=body, leftIndent=10, textColor=colors.HexColor('#555f6b'))))
        else: story.append(Paragraph(inline(s), body))
    flush_code(buf, story); flush_table(trows, story)
    doc = SimpleDocTemplate(pdf_path, pagesize=A4,
        leftMargin=1.7*cm, rightMargin=1.7*cm, topMargin=1.5*cm, bottomMargin=1.5*cm, title=title)
    doc.build(story)
    print('WROTE', pdf_path, os.path.getsize(pdf_path), 'bytes')

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    convert(os.path.join(root, 'TECHNICAL-REVIEW.md'),
            os.path.join(root, 'TECHNICAL-REVIEW.pdf'),
            'WebSketch 3D — Technical Review: Design &amp; Analysis Workspace (ACI 318-19)')
