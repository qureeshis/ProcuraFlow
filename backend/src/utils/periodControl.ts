import db from '../db';

export type PostingActor={id:number;role:string};

export function assertPostingPeriod(postingDate:unknown,actor:PostingActor,overrideReason?:unknown){
  const date=String(postingDate||new Date().toISOString().slice(0,10)).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Object.assign(new Error('A valid posting date is required'),{status:400});
  const period=db.prepare(`SELECT * FROM accounting_periods WHERE start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1`).get(date,date) as any;
  // Existing installations remain operational until management configures the
  // first controlled period. Once periods exist, uncovered dates are blocked.
  const configured=(db.prepare('SELECT COUNT(*) count FROM accounting_periods').get() as any).count>0;
  if(!period){if(configured)throw Object.assign(new Error(`Posting date ${date} is outside every configured accounting period`),{status:409});return{date,status:'OPEN',period:null};}
  if(period.status==='CLOSED')throw Object.assign(new Error(`Accounting period ${period.fiscal_year}/${period.period_number} is CLOSED`),{status:409});
  if(period.status==='SOFT CLOSED'){
    if(actor.role!=='SupplyChainManager')throw Object.assign(new Error(`Accounting period ${period.fiscal_year}/${period.period_number} is SOFT CLOSED`),{status:403});
    if(!String(overrideReason||'').trim())throw Object.assign(new Error('A documented override reason is required for a soft-closed period'),{status:400});
  }
  return{date,status:period.status,period};
}
