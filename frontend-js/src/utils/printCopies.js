import html2canvas from 'html2canvas';
export const COMPANY_COPY = { title: 'COMPANY RECORD COPY', purpose: 'Official controlled copy — retain in the company document record.' };
export function printControlledCopies(documentId, secondParty) {
    return printControlledCopySet(documentId, documentId === 'finance-pack-print-document'
        ? [FINANCE_PROCESSING_COPY, VENDOR_REFERENCE_COPY, WAREHOUSE_RECORD_COPY]
        : [COMPANY_COPY, secondParty]);
}
export async function printControlledCopySet(documentId, copies) {
    const source = document.getElementById(documentId);
    if (!source)
        throw new Error('Printable document is not available');
    const outputText = String(source.textContent || '').replace(/\s+/g, ' ').toUpperCase();
    const inferredAuthorization = /STATUS[: ]+(APPROVED|PRINTED|CLOSED|POSTED|RECEIVED|IN TRANSIT)/.test(outputText) || outputText.includes('GOODS RECEIPT NOTE') || (outputText.includes('PURCHASE REQUISITION') && !outputText.includes('PENDING APPROVAL'));
    if (documentId.includes('document') && documentId !== 'report-print-document' && source.dataset.outputAuthorized !== 'true' && !(source.dataset.outputAuthorized == null && inferredAuthorization))
        throw new Error('This document cannot be printed until its approval or authorized posting is complete');
    if (!copies.length)
        throw new Error('At least one print copy is required');
    document.getElementById('dual-copy-print-root')?.remove();
    const root = document.createElement('div');
    root.id = 'dual-copy-print-root';
    const financeCanvas = documentId === 'finance-pack-print-document'
        ? await html2canvas(source, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
        : null;
    const financeImage = financeCanvas?.toDataURL('image/jpeg', .97);
    copies.forEach((copy, index) => {
        const page = document.createElement('section');
        page.className = 'controlled-print-copy';
        const marker = document.createElement('div');
        marker.className = 'copy-control-marker';
        marker.innerHTML = documentId === 'finance-pack-print-document'
            ? `<strong>${copy.title}</strong><span>${copy.purpose}</span><em>Page 1 of 1</em>`
            : `<strong>${copy.title}</strong><span>${copy.purpose}</span><em><i class="page-counter"></i></em>`;
        if (financeImage) {
            const image = document.createElement('img');
            image.className = 'finance-print-image';
            image.src = financeImage;
            image.alt = 'External Finance handoff package';
            page.append(image, marker);
        }
        else {
            const clone = source.cloneNode(true);
            clone.removeAttribute('id');
            clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
            clone.classList.add('controlled-document-clone');
            page.append(clone, marker);
        }
        root.appendChild(page);
    });
    document.body.appendChild(root);
    document.body.classList.add('dual-copy-print');
    await Promise.all(Array.from(root.querySelectorAll('img')).map(image => image.decode().catch(() => undefined)));
    const cleanup = () => { root.remove(); document.body.classList.remove('dual-copy-print'); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup, { once: true });
    requestAnimationFrame(() => { window.print(); window.setTimeout(cleanup, 500); });
}
export function printElement(documentId) {
    return printControlledCopySet(documentId, [COMPANY_COPY]);
}
export const PO_VENDOR_COPY = { title: 'VENDOR ISSUE COPY', purpose: 'Issued to the vendor for order fulfilment, delivery and invoice reference.' };
export const GRN_VENDOR_COPY = { title: 'VENDOR ACKNOWLEDGEMENT COPY', purpose: 'Issued to the vendor as evidence of the quantities received and inspected.' };
export const MANAGEMENT_COPY = { title: 'HIGHER MANAGEMENT REVIEW COPY', purpose: 'Presented to the authorized management signatory for decision and signature.' };
export const FINANCE_COPY = { title: 'EXTERNAL HANDOFF COPY', purpose: 'Controlled supporting evidence exported by Supply Chain for the external Finance process.' };
export const FINANCE_PROCESSING_COPY = { title: 'FINANCE PROCESSING COPY', purpose: 'Primary controlled copy for invoice verification and payment processing.' };
export const VENDOR_REFERENCE_COPY = { title: 'VENDOR REFERENCE COPY', purpose: 'Supplier reference copy confirming the documents presented for payment verification.' };
export const WAREHOUSE_RECORD_COPY = { title: 'WAREHOUSE RECORD COPY', purpose: 'Internal receipt-control copy retained with the warehouse receiving record.' };
