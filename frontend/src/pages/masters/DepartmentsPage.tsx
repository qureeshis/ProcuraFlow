import React from 'react';
import MasterDataPage from './MasterDataPage';

const FACTORY_DEPARTMENTS = [
  'Production',
  'Maintenance',
  'Quality',
  'Electrical',
  'Mechanical',
  'Planning',
  'Logistics',
  'Safety',
  'Admin',
  'Procurement',
  'Warehouse',
  'Engineering',
];

export default function DepartmentsPage() {
  return (
    <MasterDataPage
      title="Departments"
      description="Add factory departments such as Production, Maintenance, Planning, Safety, and Logistics."
      endpoint="/masters/departments"
      columns={[{ key: 'name', label: 'Department Name' }]}
      fields={[{ key: 'name', label: 'Department Name' }]}
    />
  );
}
