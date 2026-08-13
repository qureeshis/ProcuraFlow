import React, { createContext, useContext, useEffect, useState } from 'react';
import client from '../api/client';
import { PRODUCT_BRAND } from '../config/brand';

export type CompanyBranding = { company_name:string; logo_url:string|null; address?:string; phone?:string; email?:string; website?:string; tax_info?:string; registration_number?:string; branch_info?:string; currency?:string; financial_year?:string };
const fallback:CompanyBranding={company_name:'Company Name',logo_url:null};
const BrandingContext=createContext({company:fallback,product:PRODUCT_BRAND,refresh:async()=>{}});
export function BrandingProvider({children}:{children:React.ReactNode}){
 const [company,setCompany]=useState(fallback);
 async function refresh(){try{const {data}=await client.get('/settings/branding');setCompany(data);document.title=`${data.company_name||'Company'} | ${PRODUCT_BRAND.name}`;}catch{document.title=PRODUCT_BRAND.fullName;}}
 useEffect(()=>{refresh();},[]);
 return <BrandingContext.Provider value={{company,product:PRODUCT_BRAND,refresh}}>{children}</BrandingContext.Provider>;
}
export const useBranding=()=>useContext(BrandingContext);
