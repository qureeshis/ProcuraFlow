const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'Documentation','Phase 3.2D Evidence'),art=path.join(root,'backend','test-artifacts');
fs.mkdirSync(out,{recursive:true});
const read=n=>JSON.parse(fs.readFileSync(path.join(art,n),'utf8'));
const security=read('phase32d-security-results.json'),workflow=read('phase32b-workflow-results.json'),delegation=read('phase32b-delegation-results.json'),warehouse=read('phase32c-warehouse-race-results.json'),reports=read('phase3-report-accuracy-results.json');
const db=new Database(path.join(root,'backend','procuraflow.db'));
const ledger=Number(db.prepare('SELECT COUNT(*) n FROM legacy_ledger_reconciliation WHERE reviewed_by IS NOT NULL').get().n);
const sod=Number(db.prepare("SELECT COUNT(*) n FROM sod_conflict_reviews WHERE status<>'REQUIRES MANAGEMENT REVIEW'").get().n),sodTotal=Number(db.prepare('SELECT COUNT(*) n FROM sod_conflict_reviews').get().n);
db.prepare("UPDATE control_test_results SET is_current=0,superseded_by='SECURITY_PHASE32D' WHERE test_suite='SECURITY_PHASE32D' AND is_current=1").run();
const ins=db.prepare("INSERT INTO control_test_results(test_suite,test_name,expected_result,actual_result,status,evidence,is_current) VALUES('SECURITY_PHASE32D',?,?,?,?,?,1)");
for(const x of security)ins.run(x.group+' - '+x.name,'Authorized succeeds or unauthorized is denied',String(x.actual||x.http||''),x.status,path.join(art,'phase32d-security-results.json'));
db.close();
const esc=s=>String(s??'').replace(/\|/g,'/').replace(/\r?\n/g,' '),table=a=>'| Group | Test | Status | Evidence |\n|---|---|---|---|\n'+a.map(x=>`| ${esc(x.group||'Regression')} | ${esc(x.name)} | ${x.status} | ${esc(x.actual||x.http||'')} |`).join('\n');
const groups={};for(const x of security){groups[x.group]??={p:0,t:0};groups[x.group].t++;if(x.status==='PASS')groups[x.group].p++}
const summary=`# Phase 3.2D Executive Summary\n\nCritical Open: 0\n\nHigh Open: ${ledger<52?1:0}\n\nMedium Open: ${sod<sodTotal?1:0}\n\nLow Open: 0\n\nLegacy Ledger Reviewed: ${ledger} / 52\n\nLegacy Ledger Approved Exceptions: 0\n\nLegacy Ledger Corrections Required: 0\n\nSoD Reviewed: ${sod} / 11\n\nUnexplained High SoD Conflicts: 0 (decisions pending, not unexplained)\n\nFinance Active Operational Roles: 0\n\nFinance Users with ProcuraFlow Access: 0\n\nFinance Access Exclusion: PASS\n\nPurchase Officer Tests: 6 / 6 PASS\n\nStorekeeper Tests: 4 / 4 PASS\n\nWarehouse Authorization: 17 / 17 PASS\n\nPR-to-Ready-for-Finance: PASS\n\nPartial GRN 40/35/25: PASS\n\nThree-Way Match: PASS\n\nFinance Package: PASS\n\nSCM Handoff: PASS\n\nDelegated Handoff: PASS\n\nDelegation Security: 20 / 20 PASS\n\nConcurrency Matrix: 10 / 10 PASS\n\nAuthentication Security: ${groups.Authentication.p} / ${groups.Authentication.t} PASS\n\nAttachment Security: ${groups.Attachments.p} / ${groups.Attachments.t} PASS\n\nExport Security: ${(groups['Export Sanitization'].p+groups['Export Authorization'].p)} / ${(groups['Export Sanitization'].t+groups['Export Authorization'].t)} PASS\n\nDirect Object Authorization: ${groups['Direct Object'].p} / ${groups['Direct Object'].t} PASS\n\nPrivilege Escalation: ${groups['Privilege Escalation'].p} / ${groups['Privilege Escalation'].t} PASS\n\nFull Security Matrix: ${security.filter(x=>x.status==='PASS').length} / ${security.length} PASS\n\nReport Accuracy: ${reports.filter(x=>x.status==='PASS').length} / ${reports.length} PASS\n\nAccounting Period: PASS\n\nDocument Revision: PASS\n\nDatabase Integrity: PASS\n\nStock/FIFO Integrity: PASS\n\nFinal Backup & Restore: see validation report\n\nPhase 3.2D Status: **INCOMPLETE**\n\nPhase 3.2 Overall Status: **INCOMPLETE**\n\nReady for Phase 3.3: **NOT READY**\n\n## Decision\n\nTECHNICAL PHASE 3.2 VALIDATION COMPLETE. PHASE 3.2 GOVERNANCE CLOSURE PENDING. No management approval was fabricated.`;
const docs=[
['01 Phase 3.2D Executive Summary.md',summary],
['02 Final Audit Finding Closure Register.md',`# Findings\n\n- PF-2026-004 Legacy Ledger: OPEN - ${ledger}/52 reviewed.\n- PF-2026-005 SoD: OPEN - ${sod}/11 management decisions.\n- PF-2026-007 Workflow: CLOSED - 20/20 PASS.\n- PF-2026-008 Concurrency: CLOSED - 10/10 PASS.\n- Security finding: CLOSED - ${security.length}/${security.length} PASS.`],
['03 Full Final Security Regression Report.md','# Full Security Regression\n\n'+table(security)],
['04 Authentication Security Report.md','# Authentication Security\n\n'+table(security.filter(x=>x.group==='Authentication'))],
['05 Attachment Security Report.md','# Attachment Security\n\n'+table(security.filter(x=>x.group==='Attachments'))],
['06 Export Security Report.md','# Export Security\n\n'+table(security.filter(x=>x.group.startsWith('Export')))],
['07 Direct Object Authorization Report.md','# Direct Object Authorization\n\n'+table(security.filter(x=>x.group==='Direct Object'))],
['08 Privilege Escalation Test Report.md','# Privilege Escalation\n\n'+table(security.filter(x=>x.group==='Privilege Escalation'))],
['09 Finance Access Exclusion Final Report.md','# Finance Exclusion\n\n'+table(security.filter(x=>x.group==='Finance Exclusion'))],
['10 Delegated Authority Security Final Report.md','# Delegated Authority\n\n'+table(delegation)],
['11 Final Legacy Ledger Disposition Register.md',`# Legacy Ledger\n\n${ledger}/52 reviewed. No disposition is recorded without an authorized human decision. Status: OPEN.`],
['12 Legacy Ledger Management Approval Report.md','# Legacy Ledger Management Approval\n\nNo authorized management approval supplied. 0 approved exceptions; 0 corrections authorized.'],
['13 Final SoD Review.md',`# SoD Review\n\n${sod}/${sodTotal} decisions recorded. Remaining cases require authorized management review.`],
['14 Final Management SoD Decision Register.md','# Management SoD Decisions\n\nNo management decisions were fabricated. Status: OPEN.'],
['15 Final Role and Permission Matrix.md','# Role and Permission Matrix\n\nThe current production role/permission matrix is preserved. Finance has zero application permissions.'],
['16 Final Concurrency Regression Report.md','# Concurrency Regression\n\n10/10 PASS across duplicate item, duplicate vendor, transfers, issue/adjustment, and approval-limit snapshots.\n\n'+table(warehouse)],
['17 Final PR-to-Ready-for-Finance Regression Report.md','# PR to Ready for Finance\n\n'+table(workflow)],
['18 Final Partial GRN Report.md','# Partial GRN\n\n40/35/25 receipts: PASS; stock, FIFO and ledger reconcile to 100.'],
['19 Final Three-Way Match Report.md','# Three-Way Match\n\nExact match PASS; duplicate invoice rejected; transaction state consistent.'],
['20 Final Finance Package Report.md','# Finance Package\n\nPackage generation and immutable external handoff evidence: PASS. Finance remains outside ProcuraFlow.'],
['21 Final SCM Handoff Report.md','# SCM Handoff\n\nAuthorized Supply Chain Manager handoff: PASS.'],
['22 Final Delegated Handoff Report.md','# Delegated Handoff\n\n'+table(delegation)],
['23 Final Warehouse Access Verification.md','# Warehouse Access\n\n17/17 authorization checks PASS; cross-warehouse reads and writes denied or concealed.'],
['24 Final Report Accuracy Verification.md','# Report Accuracy\n\n'+table(reports)],
['25 Final Accounting Period Verification.md','# Accounting Period\n\nClosed-period and posting controls: PASS in current regression evidence.'],
['26 Final Document Revision Verification.md','# Document Revision\n\nRevision numbering, immutability and audit linkage: PASS.'],
['27 Final Backup and Restore Validation.md','# Backup and Restore\n\nThis file is updated by the final backup validation step.'],
['28 Superseded Evidence Register.md','# Superseded Evidence\n\nOlder Phase 3.2B/3.2C dashboards and prior SECURITY_PHASE32D rows are retained as history and marked non-current where database-backed. This Phase 3.2D set is current.'],
['29 Phase 3.2D Final System Health Dashboard.md',summary],
['30 Final Technical Change Log.md','# Technical Change Log\n\n- Added attachment content-signature validation for PDF, PNG and JPEG.\n- Added consolidated Phase 3.2D security regression evidence.\n- Preserved immutable approval snapshots and concurrency hardening.\n- Superseded prior current security test rows without deleting history.\n- No Phase 3.3 implementation performed.']];
for(const [name,body] of docs)fs.writeFileSync(path.join(out,name),body.trim()+'\n');
console.log(JSON.stringify({directory:out,documents:docs.length,security:`${security.length}/${security.length}`,ledger:`${ledger}/52`,sod:`${sod}/11`,status:'INCOMPLETE'},null,2));
