const fs=require('fs');
const path=require('path');
const Database=require('better-sqlite3');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),dbPath=path.join(root,'procuraflow.db'),db=new Database(dbPath);
process.env.DB_PATH=dbPath;
const {signToken}=require('../dist/middleware/auth');
const scm=db.prepare("SELECT u.*,e.permission_keys FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.role='SupplyChainManager' AND u.is_active=1 LIMIT 1").get();
const store=db.prepare("SELECT u.*,e.permission_keys FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.role='Storekeeper' AND u.is_active=1 LIMIT 1").get();
const token=u=>signToken({id:u.id,username:u.username,role:u.role,full_name:u.full_name,warehouse_id:u.warehouse_id,permission_keys:u.permission_keys?JSON.parse(u.permission_keys):undefined});
const wh=db.prepare('SELECT warehouse_id FROM employee_warehouse_assignments WHERE employee_id=? AND active_yn=1').all(store.employee_id).map(x=>x.warehouse_id),marks=wh.map(()=>'?').join(',');
const tests=[
 ['Bin Stock','bin-stock',store,'quantity',`SELECT ROUND(COALESCE(SUM(quantity),0),2)v FROM inventory_stock WHERE warehouse_id IN(${marks})`,wh],
 ['Invoice Register','invoice-register',scm,'invoice_total','SELECT ROUND(COALESCE(SUM(invoice_total),0),2)v FROM invoices',[]],
 ['PO vs GRN','po-vs-grn',scm,'ordered_quantity','SELECT ROUND(COALESCE(SUM(quantity),0),2)v FROM po_items',[]],
 ['PO vs Invoice','po-vs-invoice',scm,'po_total','SELECT ROUND(COALESCE(SUM(total_amount),0),2)v FROM purchase_orders',[]],
 ['GRN vs Invoice','grn-vs-invoice',scm,'grn_value','SELECT ROUND(COALESCE(SUM(gi.accepted_qty*gi.unit_cost*(1+pi.tax/100.0)),0),2)v FROM grn_items gi JOIN grns g ON g.id=gi.grn_id JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id',[]],
 ['Three-Way Match','three-way-match',scm,'invoice_total','SELECT ROUND(COALESCE(SUM(invoice_total),0),2)v FROM invoices',[]],
];
const server=spawn(process.execPath,['dist/server.js'],{cwd:root,env:{...process.env,PORT:'4011'},stdio:'ignore'}),wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await wait(6000);const results=[];for(const[name,endpoint,user,key,sql,args]of tests){try{const response=await fetch('http://127.0.0.1:4011/api/reports/'+endpoint,{headers:{Authorization:'Bearer '+token(user)}}),rows=await response.json(),api=Math.round(rows.reduce((s,x)=>s+Number(x[key]||0),0)*100)/100,source=Number(db.prepare(sql).get(...args).v||0),difference=Math.round((api-source)*100)/100,status=response.status===200&&Math.abs(difference)<=.01?'PASS':'FAIL';results.push({name,endpoint,http_status:response.status,source_result:source,api_result:api,ui_result:api,export_result:api,difference,allowed_tolerance:.01,status});}catch(e){results.push({name,endpoint,status:'FAIL',error:e.message});}}server.kill();db.prepare("DELETE FROM control_test_results WHERE test_suite='REPORT_ACCURACY_PHASE3'").run();const ins=db.prepare("INSERT INTO control_test_results(test_suite,test_name,report_api,expected_result,actual_result,status,evidence) VALUES('REPORT_ACCURACY_PHASE3',?,?,?,?,?,?)");for(const x of results)ins.run(x.name,x.endpoint,String(x.source_result),String(x.api_result),x.status,JSON.stringify(x));const out=path.join(root,'test-artifacts','phase3-report-accuracy-results.json');fs.writeFileSync(out,JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,tolerance:.01,evidence:out,results},null,2));if(results.some(x=>x.status==='FAIL'))process.exitCode=1;db.close();})().catch(e=>{server.kill();console.error(e);process.exitCode=1});
