import db from '../db';

const iso=(d:Date)=>d.toISOString().slice(0,10);
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;};
function firstSunday(date:Date){const first=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));return addDays(first,(7-first.getUTCDay())%7);}
export function calendarWindow(){const today=new Date(`${iso(new Date())}T00:00:00Z`),cycle=firstSunday(today);return{from:iso(cycle),current_to:iso(addDays(cycle,14)),next_from:iso(addDays(cycle,15)),to:iso(addDays(cycle,29))};}
const dates=(from:string,to:string)=>{const out:string[]=[];for(let d=new Date(`${from}T00:00:00Z`);iso(d)<=to;d=addDays(d,1))out.push(iso(d));return out;};
const activeShifts=()=>db.prepare("SELECT * FROM shifts WHERE active_yn=1 ORDER BY CASE shift_code WHEN 'MORNING' THEN 1 WHEN 'AFTERNOON' THEN 2 ELSE 3 END").all() as any[];

function scheduleGroup(department:any,warehouseId:number|null,role:string,from:string,to:string,userId?:number){
 const shifts=activeShifts();if(!shifts.length)return 0;
 const companyCountry=(db.prepare("SELECT country_code FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1").get() as any)?.country_code||'SA';
 const holidayRows=db.prepare('SELECT * FROM holidays WHERE country_code=? AND active_yn=1 AND holiday_date BETWEEN ? AND ?').all(companyCountry,from,to) as any[];
 const holidays=new Map<string,any>(holidayRows.map(h=>[h.holiday_date,h]));
 const employees=db.prepare(`SELECT id,approval_role role_code,warehouse_id FROM employees WHERE department_id=? AND approval_role=? AND status='Active' AND deleted_at IS NULL AND (? IS NULL OR warehouse_id=?) AND (employment_start_date IS NULL OR employment_start_date<=?) AND (employment_end_date IS NULL OR employment_end_date>=?) ORDER BY id`).all(department.id,role,warehouseId,warehouseId,to,from) as any[];
 if(!employees.length)return 0;
 const placeholders=employees.map(()=>'?').join(',');
 const history=db.prepare(`SELECT c.employee_id,s.shift_code,COUNT(*) n FROM employee_work_calendar c LEFT JOIN shifts s ON s.id=c.shift_id WHERE c.employee_id IN (${placeholders}) AND c.calendar_date<? AND c.day_type IN('WORKDAY','HOLIDAY_WORKING') GROUP BY c.employee_id,s.shift_code`).all(...employees.map(e=>e.id),from) as any[];
 const counts=new Map<string,number>();history.forEach(h=>counts.set(`${h.employee_id}:${h.shift_code}`,Number(h.n)));
 const insert=db.prepare(`INSERT OR IGNORE INTO employee_work_calendar(employee_id,department_id,warehouse_id,role_code,calendar_date,day_type,shift_id,shift_start,shift_end,holiday_id,status,assignment_source,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,'LOCKED','AUTO',?)`);
 let created=0;
 for(const [day,date] of dates(from,to).entries())for(const [index,employee] of employees.entries()){
  if(db.prepare('SELECT 1 FROM employee_work_calendar WHERE employee_id=? AND calendar_date=?').get(employee.id,date))continue;
  const unavailable=db.prepare("SELECT 1 FROM employee_availability WHERE employee_id=? AND ? BETWEEN date_from AND date_to AND availability_status<>'Available' LIMIT 1").get(employee.id,date);
  let dayType='WORKDAY',shift:any=null;
  if(unavailable||(employees.length>1&&(day+index)%7===6))dayType='OFF';
  else{
   shift=employees.length===1?(shifts.find(s=>s.shift_code==='MORNING')||shifts[0]):[...shifts].sort((a,b)=>(counts.get(`${employee.id}:${a.shift_code}`)||0)-(counts.get(`${employee.id}:${b.shift_code}`)||0)||((shifts.indexOf(a)-(day+index)+shifts.length)%shifts.length)-((shifts.indexOf(b)-(day+index)+shifts.length)%shifts.length))[0];
   if(holidays.has(date))dayType='HOLIDAY_WORKING';counts.set(`${employee.id}:${shift.shift_code}`,(counts.get(`${employee.id}:${shift.shift_code}`)||0)+1);
  }
  created+=insert.run(employee.id,department.id,warehouseId,role,date,dayType,shift?.id||null,shift?.start_time||null,shift?.end_time||null,holidays.get(date)?.id||null,userId||null).changes;
 }
 return created;
}

function groups(){const departments=db.prepare("SELECT id,name FROM departments WHERE deleted_at IS NULL AND lower(name) IN('warehouse','procurement')").all() as any[];const out:any[]=[];for(const department of departments){const rows=db.prepare(`SELECT DISTINCT approval_role role_code,CASE WHEN lower(?)='warehouse' THEN warehouse_id ELSE NULL END warehouse_id FROM employees WHERE department_id=? AND status='Active' AND deleted_at IS NULL AND approval_role IS NOT NULL`).all(department.name,department.id) as any[];rows.forEach(r=>{if(String(department.name).toLowerCase()!=='warehouse'||r.warehouse_id)out.push({department,role:String(r.role_code),warehouseId:r.warehouse_id==null?null:Number(r.warehouse_id)});});}return out;}

export function generateRollingCalendar(userId?:number,force=false){const range=calendarWindow(),today=new Date(`${iso(new Date())}T00:00:00Z`),scheduled=today.getUTCDay()===0&&today.getUTCDate()<=7,existing=Number((db.prepare('SELECT COUNT(*) n FROM employee_work_calendar WHERE calendar_date BETWEEN ? AND ?').get(range.from,range.to)as any)?.n||0),repairing=existing>0;if(!scheduled&&!force&&!repairing)return{created:0,skipped:true,reason:'Automatic generation runs on the first Sunday of each month',...range};let created=0;db.transaction(()=>{for(const g of groups())created+=scheduleGroup(g.department,g.warehouseId,g.role,range.from,range.to,userId);})();return{created,skipped:false,scheduled_cycle:scheduled,repair_cycle:repairing&&!scheduled,...range};}

export function recalculateEmployeeSchedule(employeeId:number,from:string,to:string,triggerType:string,reason:string,userId?:number){
 const employee=db.prepare(`SELECT e.*,d.name department_name FROM employees e JOIN departments d ON d.id=e.department_id WHERE e.id=?`).get(employeeId) as any;if(!employee)throw new Error('Employee not found');
 const today=calendarWindow().from,start=from<today?today:from,end=to<start?start:to;const horizon=calendarWindow().to> end?calendarWindow().to:end;
 const protectedRows=db.prepare(`SELECT c.id,c.calendar_date,c.status,c.manual_override_yn FROM employee_work_calendar c WHERE c.employee_id=? AND c.calendar_date BETWEEN ? AND ? AND (c.status IN('PUBLISHED','LOCKED') OR c.manual_override_yn=1)`).all(employeeId,start,horizon) as any[];
 const groupParams=[employee.department_id,employee.approval_role,employee.warehouse_id??null,employee.warehouse_id??null,start,horizon];
 const before=Number((db.prepare(`SELECT COUNT(*) n FROM employee_work_calendar WHERE department_id=? AND role_code=? AND (? IS NULL OR warehouse_id=?) AND calendar_date BETWEEN ? AND ? AND assignment_source='AUTO' AND status IN('DRAFT','PROVISIONAL')`).get(...groupParams) as any).n||0);
 db.transaction(()=>{
  db.prepare(`DELETE FROM employee_work_calendar WHERE department_id=? AND role_code=? AND (? IS NULL OR warehouse_id=?) AND calendar_date BETWEEN ? AND ? AND assignment_source='AUTO' AND status IN('DRAFT','PROVISIONAL')`).run(...groupParams);
  const department={id:employee.department_id,name:employee.department_name};scheduleGroup(department,String(employee.department_name).toLowerCase()==='warehouse'?employee.warehouse_id:null,employee.approval_role,start,horizon,userId);
 })();
 const after=Number((db.prepare(`SELECT COUNT(*) n FROM employee_work_calendar WHERE department_id=? AND role_code=? AND (? IS NULL OR warehouse_id=?) AND calendar_date BETWEEN ? AND ? AND assignment_source='AUTO' AND status IN('DRAFT','PROVISIONAL')`).get(...groupParams) as any).n||0);
 let warnings=protectedRows.length;
 db.prepare(`UPDATE calendar_coverage_warnings SET warning_status='RESOLVED',resolved_at=datetime('now'),resolved_by=? WHERE department_id=? AND role_code=? AND warehouse_id IS ? AND calendar_date BETWEEN ? AND ? AND warning_status='OPEN'`).run(userId||null,employee.department_id,employee.approval_role,employee.warehouse_id??null,start,horizon);
 for(const p of protectedRows)db.prepare(`INSERT INTO calendar_coverage_warnings(calendar_date,department_id,warehouse_id,role_code,required_staff,available_staff,reason) VALUES(?,?,?,?,1,0,?)`).run(p.calendar_date,employee.department_id,employee.warehouse_id,employee.approval_role,`Protected ${p.status} or manual assignment conflicts with ${triggerType}`);
 const requirements=db.prepare(`SELECT r.*,s.shift_label FROM role_shift_requirements r JOIN shifts s ON s.id=r.shift_id WHERE r.department_id=? AND r.role_code=? AND r.active_yn=1`).all(employee.department_id,employee.approval_role) as any[];
 for(const date of dates(start,horizon))for(const requirement of requirements){if(date<requirement.effective_from||date>(requirement.effective_to||'9999-12-31'))continue;const available=Number((db.prepare(`SELECT COUNT(*) n FROM employee_work_calendar WHERE department_id=? AND role_code=? AND warehouse_id IS ? AND calendar_date=? AND shift_id=? AND day_type IN('WORKDAY','HOLIDAY_WORKING')`).get(employee.department_id,employee.approval_role,employee.warehouse_id??null,date,requirement.shift_id) as any).n||0);if(available<Number(requirement.minimum_staff)){warnings++;db.prepare(`INSERT INTO calendar_coverage_warnings(calendar_date,department_id,warehouse_id,role_code,shift_id,required_staff,available_staff,reason) VALUES(?,?,?,?,?,?,?,?)`).run(date,employee.department_id,employee.warehouse_id,employee.approval_role,requirement.shift_id,requirement.minimum_staff,available,`${requirement.shift_label} coverage below configured minimum after ${triggerType}`);}}
 const audit=db.prepare(`INSERT INTO calendar_regeneration_audit(trigger_type,employee_id,department_id,warehouse_id,role_code,affected_from,affected_to,reason,assignments_changed,coverage_warnings,details_json,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(triggerType,employee.id,employee.department_id,employee.warehouse_id,employee.approval_role,start,horizon,reason,Math.max(before,after),warnings,JSON.stringify({requested_to:to,protected_entries:protectedRows.map(p=>p.id)}),userId||null);
 return{regeneration_id:Number(audit.lastInsertRowid),affected_from:start,affected_to:horizon,assignments_changed:Math.max(before,after),coverage_warnings:warnings};
}

export function schedulingKpis(){const w=calendarWindow(),today=w.from;return db.prepare(`SELECT (SELECT COUNT(*) FROM employees e JOIN departments d ON d.id=e.department_id WHERE e.status='Active' AND e.deleted_at IS NULL AND lower(d.name)='warehouse') active_warehouse_employees,(SELECT COUNT(*) FROM employees e JOIN departments d ON d.id=e.department_id WHERE e.status='Active' AND e.deleted_at IS NULL AND lower(d.name)='procurement') active_procurement_employees,SUM(CASE WHEN c.calendar_date=? AND s.shift_code='MORNING' AND c.day_type IN('WORKDAY','HOLIDAY_WORKING') THEN 1 ELSE 0 END) morning_today,SUM(CASE WHEN c.calendar_date=? AND s.shift_code='AFTERNOON' AND c.day_type IN('WORKDAY','HOLIDAY_WORKING') THEN 1 ELSE 0 END) afternoon_today,SUM(CASE WHEN c.calendar_date=? AND s.shift_code='EVENING' AND c.day_type IN('WORKDAY','HOLIDAY_WORKING') THEN 1 ELSE 0 END) evening_today,SUM(CASE WHEN c.calendar_date=? AND c.day_type='OFF' THEN 1 ELSE 0 END) off_today,SUM(CASE WHEN c.calendar_date=? AND c.day_type='HOLIDAY_WORKING' THEN 1 ELSE 0 END) holiday_workers_today,SUM(CASE WHEN c.calendar_date BETWEEN ? AND ? THEN 1 ELSE 0 END) next_15_entries,SUM(CASE WHEN c.calendar_date BETWEEN ? AND ? AND c.status IN('DRAFT','PROVISIONAL') THEN 1 ELSE 0 END) unpublished_entries,SUM(CASE WHEN c.calendar_date BETWEEN ? AND ? AND c.manual_override_yn=1 THEN 1 ELSE 0 END) manual_adjustments,(SELECT COUNT(*) FROM calendar_coverage_warnings WHERE warning_status='OPEN') coverage_warnings FROM employee_work_calendar c LEFT JOIN shifts s ON s.id=c.shift_id`).get(today,today,today,today,today,w.next_from,w.to,w.next_from,w.to,w.from,w.to) as any;}
