import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { drawPdfBrandFooter } from '../config/documentTheme';
export async function downloadElementPdf(elementId, filename, options = {}) {
    const element = document.getElementById(elementId);
    if (!element)
        throw new Error('Printable document is not available');
    const outputText = String(element.textContent || '').replace(/\s+/g, ' ').toUpperCase();
    const inferredAuthorization = /STATUS[: ]+(APPROVED|PRINTED|CLOSED|POSTED|RECEIVED|IN TRANSIT)/.test(outputText) || outputText.includes('GOODS RECEIPT NOTE') || (outputText.includes('PURCHASE REQUISITION') && !outputText.includes('PENDING APPROVAL'));
    if (elementId.includes('document') && elementId !== 'report-print-document' && element.dataset.outputAuthorized !== 'true' && !(element.dataset.outputAuthorized == null && inferredAuthorization))
        throw new Error('This document cannot be downloaded until its approval or authorized posting is complete');
    await Promise.all(Array.from(element.querySelectorAll('img')).map(image => image.complete ? image.decode().catch(() => undefined) : new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })));
    const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
    const orientation = options.orientation || 'portrait', requestedCopies = elementId === 'finance-pack-print-document' ? undefined : options.copies, copies = requestedCopies?.length ? requestedCopies : [{ title: elementId === 'finance-pack-print-document' ? 'EXTERNAL FINANCE HANDOFF PACKAGE' : 'CONTROLLED DOCUMENT', purpose: elementId === 'finance-pack-print-document' ? 'Controlled Supply Chain document exported for an external process.' : 'Official system-generated document.' }];
    const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), margin = 8, top = 8, footer = 19, printW = pageW - margin * 2, usableH = pageH - top - footer;
    if (elementId === 'finance-pack-print-document') {
        const naturalH = canvas.height * (printW / canvas.width), renderH = Math.min(naturalH, usableH), renderW = canvas.width * (renderH / canvas.height), renderX = (pageW - renderW) / 2;
        pdf.addImage(canvas.toDataURL('image/jpeg', .95), 'JPEG', renderX, top, renderW, renderH, undefined, 'FAST');
        drawPdfBrandFooter(pdf, { pageWidth: pageW, pageHeight: pageH, margin, footerTop: pageH - footer, pageLabel: 'Page 1 of 1', copyLabel: 'External Finance handoff package' });
        pdf.save(filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`);
        return;
    }
    const pixelsPerMm = canvas.width / printW, maxSliceHeight = Math.floor(usableH * pixelsPerMm), elementRect = element.getBoundingClientRect(), canvasScaleY = canvas.height / Math.max(1, elementRect.height);
    const relativeTop = (node) => (node.getBoundingClientRect().top - elementRect.top) * canvasScaleY;
    const avoidRanges = Array.from(element.querySelectorAll('tr,.print-avoid-break,header,footer')).map(node => ({ top: Math.max(0, relativeTop(node)), bottom: Math.min(canvas.height, (node.getBoundingClientRect().bottom - elementRect.top) * canvasScaleY) }));
    const tableHeaders = Array.from(element.querySelectorAll('table')).map(table => { const head = table.querySelector('thead'); if (!head)
        return null; return { tableTop: relativeTop(table), tableBottom: (table.getBoundingClientRect().bottom - elementRect.top) * canvasScaleY, headTop: relativeTop(head), headBottom: (head.getBoundingClientRect().bottom - elementRect.top) * canvasScaleY }; }).filter((entry) => Boolean(entry));
    const forcedBreaks = Array.from(element.querySelectorAll('.print-page-break-before')).map(relativeTop).sort((a, b) => a - b);
    const slices = [];
    let sliceStart = 0;
    while (sliceStart < canvas.height) {
        const activeTable = tableHeaders.find(info => sliceStart > info.headBottom + 1 && sliceStart < info.tableBottom - 1);
        const repeatedHeaderHeight = activeTable ? activeTable.headBottom - activeTable.headTop : 0;
        const availableHeight = Math.max(maxSliceHeight * .5, maxSliceHeight - repeatedHeaderHeight);
        let sliceEnd = Math.min(canvas.height, sliceStart + availableHeight);
        const forced = forcedBreaks.find(point => point > sliceStart + availableHeight * .2 && point < sliceEnd);
        if (forced)
            sliceEnd = forced;
        for (const range of avoidRanges) {
            if (range.top < sliceEnd && range.bottom > sliceEnd && range.top > sliceStart + availableHeight * .2)
                sliceEnd = Math.floor(range.top);
        }
        if (sliceEnd <= sliceStart + 1)
            sliceEnd = Math.min(canvas.height, sliceStart + availableHeight);
        slices.push({ start: Math.floor(sliceStart), end: Math.ceil(sliceEnd), repeatHeader: activeTable ? { top: Math.floor(activeTable.headTop), bottom: Math.ceil(activeTable.headBottom) } : undefined });
        sliceStart = sliceEnd;
    }
    const pagesPerCopy = slices.length, totalPages = pagesPerCopy * copies.length;
    let globalPage = 0;
    for (const copy of copies)
        for (let page = 0; page < pagesPerCopy; page++) {
            if (globalPage > 0)
                pdf.addPage('a4', orientation);
            globalPage++;
            const slice = slices[page], sliceHeight = Math.max(1, slice.end - slice.start);
            let contentTop = top;
            if (slice.repeatHeader) {
                const headerHeight = Math.max(1, slice.repeatHeader.bottom - slice.repeatHeader.top), headerCanvas = document.createElement('canvas');
                headerCanvas.width = canvas.width;
                headerCanvas.height = headerHeight;
                headerCanvas.getContext('2d').drawImage(canvas, 0, slice.repeatHeader.top, canvas.width, headerHeight, 0, 0, canvas.width, headerHeight);
                pdf.addImage(headerCanvas.toDataURL('image/jpeg', .96), 'JPEG', margin, contentTop, printW, headerHeight / pixelsPerMm, undefined, 'FAST');
                contentTop += headerHeight / pixelsPerMm;
            }
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = sliceHeight;
            pageCanvas.getContext('2d').drawImage(canvas, 0, slice.start, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
            pdf.addImage(pageCanvas.toDataURL('image/jpeg', .94), 'JPEG', margin, contentTop, printW, sliceHeight / pixelsPerMm, undefined, 'FAST');
            drawPdfBrandFooter(pdf, { pageWidth: pageW, pageHeight: pageH, margin, footerTop: pageH - footer, pageLabel: `Page ${globalPage} of ${totalPages}`, copyLabel: `${copy.title} · Copy page ${page + 1} of ${pagesPerCopy}` });
        }
    pdf.save(filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`);
}
