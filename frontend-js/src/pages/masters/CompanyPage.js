import { jsx as _jsx } from "react/jsx-runtime";
import MasterDataPage from './MasterDataPage';
export default function CompanyPage() {
    return (_jsx(MasterDataPage, { title: "Company", description: "Dynamic organization identity, contact details, registration, currency, and financial year.", endpoint: "/masters/company", singleRecord: true, columns: [
            { key: 'name', label: 'Company Name' },
            { key: 'address', label: 'Address' },
            { key: 'phone', label: 'Telephone' },
            { key: 'email', label: 'Email' },
            { key: 'website', label: 'Website' },
            { key: 'tax_info', label: 'Tax Info' },
            { key: 'currency', label: 'Currency' },
            { key: 'financial_year', label: 'Financial Year' },
        ], fields: [
            { key: 'name', label: 'Company Name' },
            { key: 'address', label: 'Address' },
            { key: 'phone', label: 'Telephone' },
            { key: 'email', label: 'Email' },
            { key: 'website', label: 'Website' },
            { key: 'registration_number', label: 'Registration Number' },
            { key: 'branch_info', label: 'Branch Information' },
            { key: 'tax_info', label: 'Tax Information' },
            { key: 'currency', label: 'Currency' },
            { key: 'financial_year', label: 'Financial Year' },
        ] }));
}
