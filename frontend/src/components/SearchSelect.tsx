import React,{useEffect,useState} from 'react';

export interface SearchOption{value:string|number;label:string}

export default function SearchSelect({label,options,value,onChange,placeholder,onSearch}:{label:string;options:SearchOption[];value:string|number;onChange:(value:any)=>void;placeholder:string;onSearch?:(value:string)=>void}){
  const [query,setQuery]=useState(''),[open,setOpen]=useState(false);
  const selectedLabel=options.find(option=>String(option.value)===String(value))?.label||'';
  // Synchronize only when the external selection changes. Parent forms often
  // rebuild the options array while typing; that must never erase the query.
  useEffect(()=>{setQuery(selectedLabel);},[value,selectedLabel]);
  const normalized=query.trim().toLocaleLowerCase();
  const filtered=options.filter(option=>!normalized||option.label.toLocaleLowerCase().includes(normalized)).slice(0,100);
  return <div className="relative"><label className="text-sm font-medium text-slate-700">{label}</label><input className="input mt-1 w-full" type="search" autoComplete="off" placeholder={placeholder} value={query} onChange={event=>{const next=event.target.value;setQuery(next);setOpen(true);onSearch?.(next);if(!next)onChange('');}} onFocus={()=>setOpen(true)} onKeyDown={event=>{if(event.key==='Enter'&&filtered.length){event.preventDefault();setQuery(filtered[0].label);onChange(filtered[0].value);setOpen(false);}if(event.key==='Escape')setOpen(false);}} onBlur={()=>window.setTimeout(()=>setOpen(false),150)}/>{open&&<div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">{filtered.length?filtered.map(option=><button key={option.value} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 focus:bg-indigo-50" onMouseDown={event=>{event.preventDefault();setQuery(option.label);onChange(option.value);setOpen(false);}}>{option.label}</button>):<div className="px-3 py-2 text-sm text-slate-500">No matching results</div>}</div>}</div>;
}
