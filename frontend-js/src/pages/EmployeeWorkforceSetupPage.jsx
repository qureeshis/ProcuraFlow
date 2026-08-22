import WorkforceSetupPage from "./WorkforceSetupPage";

export default function EmployeeWorkforceSetupPage() {
  return (
    <div className="split-setup-page">
      <h1 className="text-2xl font-bold">Workforce Setup</h1>
      <p className="mb-4 text-sm text-slate-500">
        Employee shifts, availability, minimum coverage, and helper supervision
        controls.
      </p>
      <WorkforceSetupPage section="workforce" />
    </div>
  );
}
