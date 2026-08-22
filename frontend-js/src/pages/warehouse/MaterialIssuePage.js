import {
  jsx as _jsx,
  Fragment as _Fragment,
  jsxs as _jsxs,
} from "react/jsx-runtime";
import { useEffect, useState } from "react";
import client from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { useAuth } from "../../contexts/AuthContext";
import { formatCurrency } from "../../utils/currency";
import { useSearchParams } from "react-router-dom";
import SearchSelect from "../../components/SearchSelect";
import EmployeePicker from "../../components/EmployeePicker";
import { downloadElementPdf } from "../../utils/downloadPdf";
import { printElement } from "../../utils/printCopies";
export default function MaterialIssuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const warehouseRole =
    !!user &&
    ["WarehouseManager", "WarehouseSupervisor", "Storekeeper"].includes(
      user.role,
    );
  const authorizedWarehouseIds = (user?.warehouse_ids || []).map(Number);
  // Lock the form only when the account has exactly one authorized warehouse.
  // Managers/supervisors with multiple or all-warehouse scope must select one.
  const warehouseBound = warehouseRole && authorizedWarehouseIds.length === 1;
  const assignedWarehouseId = warehouseBound ? authorizedWarehouseIds[0] : "";
  const [issues, setIssues] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [threshold, setThreshold] = useState(500);
  const [showForm, setShowForm] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState([
    {
      item_id: "",
      item_search: "",
      warehouse_id: assignedWarehouseId,
      quantity: 1,
    },
  ]);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null);
  const [stock, setStock] = useState([]);
  const [thresholdSaved, setThresholdSaved] = useState(false);
  function load() {
    client.get("/warehouse/material-issues").then((res) => setIssues(res.data));
  }
  useEffect(() => {
    load();
    client
      .get("/masters/employee-directory")
      .then((res) => setEmployees(res.data));
    client.get("/masters/departments").then((res) => setDepartments(res.data));
    client
      .get("/masters/operational-items")
      .then((res) => setItems(res.data.filter((i) => i.active_yn !== 0)));
    client.get("/masters/warehouses").then((res) => setWarehouses(res.data));
    client.get("/settings").then((res) => {
      const configured = Number(res.data.material_issue_approval_threshold);
      setThreshold(Number.isFinite(configured) ? configured : 500);
    });
    client.get("/inventory/stock").then((res) => setStock(res.data));
  }, []);
  useEffect(() => {
    const openId = Number(searchParams.get("open"));
    const target = openId ? issues.find((row) => row.id === openId) : null;
    if (!target) return;
    setSearchParams({}, { replace: true });
    viewIssue(target);
  }, [issues, searchParams, setSearchParams]);
  useEffect(() => {
    if (!assignedWarehouseId) return;
    setLines((current) =>
      current.map((line) => ({ ...line, warehouse_id: assignedWarehouseId })),
    );
  }, [assignedWarehouseId]);
  function addLine() {
    setLines((current) => [
      ...current,
      {
        item_id: "",
        item_search: "",
        warehouse_id: assignedWarehouseId,
        quantity: 1,
      },
    ]);
  }
  function removeLine(index) {
    setLines((current) =>
      current.length === 1
        ? current
        : current.filter((_, lineIndex) => lineIndex !== index),
    );
  }
  function updateLine(i, key, val) {
    setLines((current) =>
      current.map((line, index) =>
        index === i ? { ...line, [key]: val } : line,
      ),
    );
  }
  const estimatedValue = lines.reduce((sum, l) => {
    const item = items.find((it) => it.id === l.item_id);
    return sum + (l.quantity || 0) * (item?.standard_cost || 0);
  }, 0);
  const hasHighValueItem = lines.some(
    (l) =>
      items.find((it) => it.id === l.item_id)?.high_value_flag ||
      items.find((it) => it.id === l.item_id)?.always_approval_yn,
  );
  const hasReturnableItem = lines.some(
    (line) => items.find((item) => item.id === line.item_id)?.consumable_returnable === "Returnable",
  );
  const willNeedApproval =
    user?.role !== "SupplyChainManager" &&
    (estimatedValue > threshold || hasHighValueItem || hasReturnableItem);
  const issueApproverRole =
    user?.role === "WarehouseManager"
      ? "Supply Chain Manager"
      : "Warehouse Manager";
  async function submit() {
    setError("");
    if (
      !employeeId ||
      lines.some(
        (line) =>
          !line.item_id ||
          !line.warehouse_id ||
          !line.location_id ||
          !(line.quantity > 0),
      )
    )
      return setError(
        "Employee, item, storage Bin, and a quantity greater than zero are required for every line.",
      );
    const low = lines.find(
      (line) =>
        line.quantity >
        stock
          .filter(
            (s) =>
              s.item_id === line.item_id &&
              s.warehouse_id === line.warehouse_id &&
              s.location_id === line.location_id,
          )
          .reduce((sum, s) => sum + Number(s.quantity), 0),
    );
    if (low)
      return setError(
        "Requested quantity exceeds available stock. Review the available quantity shown beside each line.",
      );
    try {
      await client.post("/warehouse/material-issues", {
        employee_id: employeeId,
        purpose,
        items: lines,
      });
      setShowForm(false);
      setEmployeeId("");
      setPurpose("");
      setLines([
        {
          item_id: "",
          item_search: "",
          warehouse_id: assignedWarehouseId,
          quantity: 1,
        },
      ]);
      load();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to issue material");
    }
  }
  async function approve(id) {
    try {
      await client.put(`/warehouse/material-issues/${id}/approve`);
      load();
    } catch (e) {
      alert(e?.response?.data?.error || "Approval failed");
    }
  }
  async function reject(id) {
    try {
      await client.put(`/warehouse/material-issues/${id}/reject`);
      load();
    } catch (e) {
      alert(e?.response?.data?.error || "Rejection failed");
    }
  }
  const canApprove =
    user && ["Storekeeper", "WarehouseSupervisor", "WarehouseManager", "SupplyChainManager"].includes(user.role);
  const canConfigureThreshold = user?.role === "SupplyChainManager";
  const canViewThreshold =
    !!user && ["WarehouseManager", "SupplyChainManager"].includes(user.role);
  async function saveThreshold() {
    await client.put("/settings/material_issue_approval_threshold", {
      value: threshold,
    });
    setThresholdSaved(true);
    setTimeout(() => setThresholdSaved(false), 2000);
  }
  async function viewIssue(row) {
    try {
      setViewing(
        (await client.get(`/warehouse/material-issues/${row.id}`)).data,
      );
    } catch (e) {
      setError(e?.response?.data?.error || "Unable to view issue");
    }
  }
  return _jsxs("div", {
    children: [
      _jsxs("div", {
        className: "flex items-center justify-between mb-4",
        children: [
          _jsxs("div", {
            children: [
              _jsx("h1", {
                className: "text-xl font-semibold text-slate-900",
                children: "Material Issue",
              }),
              _jsx("p", {
                className: "text-sm text-slate-500",
                children: canViewThreshold
                  ? _jsxs(_Fragment, {
                      children: [
                        "Track consumption by employee. Issues over ",
                        formatCurrency(threshold),
                        " or containing high-value/always-approval items route to the next approval authority before stock is consumed.",
                      ],
                    })
                  : _jsx(_Fragment, {
                      children:
                        "Track consumption by employee. The system will indicate when an issue requires Warehouse Manager approval before stock is consumed.",
                    }),
              }),
            ],
          }),
          _jsx("button", {
            className: "btn-primary",
            onClick: () => setShowForm(true),
            children: "+ New Issue",
          }),
        ],
      }),
      canViewThreshold &&
        _jsxs("div", {
          className: "card p-4 mb-4",
          children: [
            _jsx("h2", {
              className: "font-semibold text-indigo-900",
              children: "Material Issue Approval Control",
            }),
            _jsx("p", {
              className: "text-xs text-slate-500 mt-1",
              children:
                "Issues above this value require Warehouse Manager approval before stock is deducted.",
            }),
            canConfigureThreshold
              ? _jsxs("div", {
                  className: "flex items-end gap-2 mt-3 max-w-md",
                  children: [
                    _jsxs("div", {
                      className: "flex-1",
                      children: [
                        _jsx("label", {
                          className: "text-sm font-medium",
                          children: "Approval Threshold",
                        }),
                        _jsx("input", {
                          className: "input mt-1",
                          type: "number",
                          min: "0",
                          value: threshold,
                          onChange: (e) => setThreshold(Number(e.target.value)),
                        }),
                      ],
                    }),
                    _jsx("button", {
                      className: "btn-secondary",
                      onClick: saveThreshold,
                      children: "Save Threshold",
                    }),
                  ],
                })
              : _jsxs("div", {
                  className: "mt-3 max-w-md",
                  children: [
                    _jsx("label", {
                      className: "text-sm font-medium",
                      children: "Approval Threshold (Read Only)",
                    }),
                    _jsx("div", {
                      className:
                        "input mt-1 bg-slate-100 font-semibold text-slate-700",
                      children: formatCurrency(threshold),
                    }),
                    _jsx("p", {
                      className: "mt-1 text-xs text-amber-700",
                      children:
                        "Only the Supply Chain Manager can change this control.",
                    }),
                  ],
                }),
            thresholdSaved &&
              _jsx("div", {
                className: "text-xs text-emerald-600 mt-2",
                children:
                  "Approval threshold saved and recorded in the audit log.",
              }),
          ],
        }),
      _jsx("div", {
        className: "card",
        children: _jsx(DataTable, {
          columns: [
            { key: "issue_number", label: "Issue Number" },
            { key: "employee_code", label: "Employee Code" },
            { key: "employee_name", label: "Employee" },
            { key: "employee_department_name", label: "Department" },
            { key: "issue_date", label: "Date" },
            {
              key: "total_value",
              label: "Value",
              render: (r) => formatCurrency(r.total_value ?? 0),
            },
            {
              key: "status",
              label: "Status",
              render: (r) => _jsx(StatusBadge, { status: r.status }),
            },
          ],
          rows: issues,
          actions: (r) =>
            _jsxs("div", {
              className: "flex gap-2 justify-end",
              children: [
                _jsx("button", {
                  className: "text-brand-600 text-xs font-medium",
                  onClick: () => viewIssue(r),
                  children: "Print / Download",
                }),
                r.status === "PendingApproval" &&
                  canApprove &&
                  _jsxs(_Fragment, {
                    children: [
                      _jsx("button", {
                        className: "text-emerald-600 text-xs font-medium",
                        onClick: () => approve(r.id),
                        children: "Approve",
                      }),
                      _jsx("button", {
                        className: "text-rose-600 text-xs font-medium",
                        onClick: () => reject(r.id),
                        children: "Reject",
                      }),
                    ],
                  }),
              ],
            }),
        }),
      }),
      showForm &&
        _jsx(Modal, {
          title: "New Material Issue",
          onClose: () => setShowForm(false),
          wide: true,
          children: _jsxs("div", {
            className: "compact-form",
            children: [
              _jsxs("div", {
                className: "rounded-lg border border-slate-200 p-4 bg-slate-50",
                children: [
                  _jsx("h3", {
                    className: "font-medium text-slate-800 mb-3",
                    children: "Issue Details",
                  }),
                  _jsx(EmployeePicker, {
                    label: "Employee receiving material",
                    employees: employees,
                    departments: departments,
                    value: employeeId,
                    onChange: (val) => setEmployeeId(val ? Number(val) : ""),
                    onCreated: (employee) =>
                      setEmployees((current) => [...current, employee]),
                  }),
                  _jsxs("div", {
                    className: "mt-3",
                    children: [
                      _jsx("label", {
                        className: "text-sm font-medium text-slate-700",
                        children: "Purpose",
                      }),
                      _jsx("input", {
                        className: "input mt-1",
                        value: purpose,
                        onChange: (e) => setPurpose(e.target.value),
                        placeholder: "e.g. Line 3 maintenance",
                      }),
                    ],
                  }),
                ],
              }),
              _jsxs("div", {
                className: "rounded-lg border border-slate-200 p-4 bg-white",
                children: [
                  _jsx("h3", {
                    className: "font-medium text-slate-800 mb-3",
                    children: "Issued Items",
                  }),
                  _jsx("div", {
                    className: "space-y-2 mt-1",
                    children: lines.map((line, i) =>
                      _jsxs(
                        "div",
                        {
                          className: "grid grid-cols-12 gap-2 items-center",
                          children: [
                            _jsx("div", {
                              className: "col-span-5",
                              children: _jsx(SearchSelect, {
                                label: "Item to Issue",
                                options: items.map((it) => ({
                                  value: it.id,
                                  label: `${it.item_code} - ${it.description}`,
                                })),
                                value: line.item_id || line.item_search || "",
                                onChange: (val) => {
                                  const selected = items.find(
                                    (it) => it.id === Number(val),
                                  );
                                  setLines((current) =>
                                    current.map((currentLine, index) =>
                                      index === i
                                        ? {
                                            ...currentLine,
                                            item_id: selected
                                              ? selected.id
                                              : "",
                                            item_search: selected
                                              ? `${selected.item_code} - ${selected.description}`
                                              : "",
                                            location_id: "",
                                          }
                                        : currentLine,
                                    ),
                                  );
                                },
                                placeholder: "Search item",
                              }),
                            }),
                            warehouseBound
                              ? _jsxs("div", {
                                  className:
                                    "input col-span-4 bg-slate-100 text-slate-700",
                                  children: [
                                    _jsx("span", {
                                      className:
                                        "block text-[10px] uppercase text-slate-500",
                                      children: "Issuing warehouse",
                                    }),
                                    warehouses.find(
                                      (w) =>
                                        Number(w.id) ===
                                        Number(assignedWarehouseId),
                                    )?.name ||
                                      user?.warehouse_name ||
                                      "Assigned warehouse",
                                  ],
                                })
                              : _jsxs("div", {
                                  className: "col-span-4",
                                  children: [
                                    _jsx("label", {
                                      className: "text-sm font-medium",
                                      children: "Issuing Warehouse",
                                    }),
                                    _jsxs("select", {
                                      className: "input mt-1",
                                      value: line.warehouse_id,
                                      onChange: (e) =>
                                        updateLine(
                                          i,
                                          "warehouse_id",
                                          Number(e.target.value),
                                        ),
                                      children: [
                                        _jsx("option", {
                                          value: "",
                                          children: "Warehouse...",
                                        }),
                                        warehouses.map((w) =>
                                          _jsx(
                                            "option",
                                            { value: w.id, children: w.name },
                                            w.id,
                                          ),
                                        ),
                                      ],
                                    }),
                                  ],
                                }),
                            _jsxs("div", {
                              className: "col-span-3",
                              children: [
                                _jsx("label", {
                                  className: "text-sm font-medium",
                                  children: "Issue Quantity",
                                }),
                                _jsx("input", {
                                  className: "input mt-1",
                                  type: "number",
                                  placeholder: "Quantity",
                                  value: line.quantity,
                                  onChange: (e) =>
                                    updateLine(
                                      i,
                                      "quantity",
                                      Number(e.target.value),
                                    ),
                                }),
                              ],
                            }),
                            _jsxs("div", {
                              className: "col-span-12",
                              children: [
                                _jsx("label", {
                                  className: "text-sm font-medium",
                                  children: "Issue From Physical Bin",
                                }),
                                _jsxs("select", {
                                  className: "input mt-1",
                                  value: line.location_id || "",
                                  onChange: (e) =>
                                    updateLine(
                                      i,
                                      "location_id",
                                      Number(e.target.value),
                                    ),
                                  children: [
                                    _jsx("option", {
                                      value: "",
                                      children: "Select stocked Bin...",
                                    }),
                                    stock
                                      .filter(
                                        (s) =>
                                          s.item_id === line.item_id &&
                                          s.warehouse_id ===
                                            line.warehouse_id &&
                                          Number(s.quantity) > 0 &&
                                          s.location_id,
                                      )
                                      .map((s) =>
                                        _jsxs(
                                          "option",
                                          {
                                            value: s.location_id,
                                            children: [
                                              s.location_code,
                                              " \u2014 Available ",
                                              Number(
                                                s.quantity,
                                              ).toLocaleString(),
                                            ],
                                          },
                                          s.id,
                                        ),
                                      ),
                                  ],
                                }),
                              ],
                            }),
                            _jsx("div", {
                              className: "col-span-12 flex justify-end",
                              children:
                                lines.length > 1 &&
                                _jsx("button", {
                                  type: "button",
                                  className:
                                    "text-xs font-medium text-rose-600 hover:text-rose-800",
                                  onClick: () => removeLine(i),
                                  children: "Remove item line",
                                }),
                            }),
                            _jsxs("div", {
                              className:
                                "col-span-12 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2 text-xs",
                              children: [
                                _jsxs("div", {
                                  className: "font-medium text-sky-900",
                                  children: [
                                    "Unit: ",
                                    items.find((it) => it.id === line.item_id)
                                      ?.issue_uom ||
                                      items.find((it) => it.id === line.item_id)
                                        ?.uom ||
                                      "—",
                                  ],
                                }),
                                line.item_id
                                  ? (() => {
                                      const balances = stock.filter(
                                        (balance) =>
                                          balance.item_id === line.item_id &&
                                          (!line.warehouse_id ||
                                            balance.warehouse_id ===
                                              line.warehouse_id),
                                      );
                                      return balances.length
                                        ? _jsxs("div", {
                                            className: "mt-1 space-y-1",
                                            children: [
                                              balances.map((balance) =>
                                                _jsxs(
                                                  "div",
                                                  {
                                                    className:
                                                      "flex flex-wrap justify-between gap-2 text-slate-700",
                                                    children: [
                                                      _jsxs("span", {
                                                        children: [
                                                          _jsx("strong", {
                                                            children:
                                                              balance.warehouse_name,
                                                          }),
                                                          " \u00B7 Location: ",
                                                          _jsx("strong", {
                                                            children:
                                                              balance.location_code
                                                                ? `${balance.location_type || "Location"} ${balance.location_code}`
                                                                : "Unassigned",
                                                          }),
                                                        ],
                                                      }),
                                                      _jsxs("span", {
                                                        children: [
                                                          "Available: ",
                                                          _jsx("strong", {
                                                            className:
                                                              "text-emerald-700",
                                                            children: Number(
                                                              balance.quantity,
                                                            ).toLocaleString(),
                                                          }),
                                                        ],
                                                      }),
                                                    ],
                                                  },
                                                  balance.id,
                                                ),
                                              ),
                                              _jsxs("div", {
                                                className:
                                                  "border-t border-sky-200 pt-1 flex justify-between font-semibold text-sky-900",
                                                children: [
                                                  _jsxs("span", {
                                                    children: [
                                                      "Total available",
                                                      line.warehouse_id
                                                        ? " in selected warehouse"
                                                        : "",
                                                    ],
                                                  }),
                                                  _jsx("span", {
                                                    children: balances
                                                      .reduce(
                                                        (sum, balance) =>
                                                          sum +
                                                          Number(
                                                            balance.quantity,
                                                          ),
                                                        0,
                                                      )
                                                      .toLocaleString(),
                                                  }),
                                                ],
                                              }),
                                            ],
                                          })
                                        : _jsxs("div", {
                                            className: "mt-1 text-rose-600",
                                            children: [
                                              "No available stock or assigned location found for this item",
                                              line.warehouse_id
                                                ? " in the selected warehouse"
                                                : "",
                                              ".",
                                            ],
                                          });
                                    })()
                                  : _jsx("div", {
                                      className: "mt-1 text-slate-500",
                                      children:
                                        "Select an item to view its warehouse location and available stock.",
                                    }),
                              ],
                            }),
                          ],
                        },
                        i,
                      ),
                    ),
                  }),
                  _jsx("button", {
                    type: "button",
                    className: "text-brand-600 text-sm font-medium mt-2",
                    onClick: addLine,
                    children: "+ Add line",
                  }),
                ],
              }),
              _jsxs("div", {
                className: `rounded-lg px-3 py-2 text-sm ${willNeedApproval ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-600"}`,
                children: [
                  "Estimated value: ",
                  formatCurrency(estimatedValue),
                  ".",
                  " ",
                  willNeedApproval
                    ? hasReturnableItem
                      ? `Returnable items require ${issueApproverRole} approval and controlled employee custody before stock is deducted.`
                      : hasHighValueItem
                        ? `High-value items require ${issueApproverRole} approval before stock is deducted.`
                        : `This issue exceeds the assigned authority limit and requires ${issueApproverRole} approval before stock is deducted.`
                    : "Below threshold — this issue will post immediately.",
                ],
              }),
              error &&
                _jsx("div", {
                  className:
                    "text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2",
                  children: error,
                }),
              _jsxs("div", {
                className: "flex justify-end gap-2 pt-2",
                children: [
                  _jsx("button", {
                    className: "btn-secondary",
                    onClick: () => setShowForm(false),
                    children: "Cancel",
                  }),
                  _jsx("button", {
                    className: "btn-primary",
                    onClick: submit,
                    children: "Submit",
                  }),
                ],
              }),
            ],
          }),
        }),
      viewing &&
        _jsx(Modal, {
          title: `Material Issue - ${viewing.issue_number}`,
          onClose: () => setViewing(null),
          wide: true,
          children: _jsxs("div", {
            className: "space-y-3 text-sm",
            children: [
              _jsxs("div", {
                className: "sticky top-0 z-10 flex justify-end gap-2 rounded-lg border border-indigo-100 bg-white/95 p-3 shadow-sm print:hidden",
                children: [
                  _jsx("button", {
                    className: "btn-secondary",
                    onClick: () => downloadElementPdf("material-issue-print-document", viewing.issue_number),
                    children: "Download PDF",
                  }),
                  _jsx("button", {
                    className: "btn-primary",
                    onClick: () => printElement("material-issue-print-document"),
                    children: "Print Document",
                  }),
                ],
              }),
              _jsx("div", {
                id: "material-issue-print-document",
                className: "space-y-3 rounded-lg bg-white p-4",
                children: _jsxs("div", {
                  className: "space-y-3",
                  children: [
              _jsxs("div", {
                children: [
                  _jsx("span", {
                    className: "text-slate-500",
                    children: "Employee:",
                  }),
                  " ",
                  viewing.employee_code,
                  " - ",
                  viewing.employee_name,
                  " — ",
                  viewing.employee_department_name || "No department",
                ],
              }),
              _jsxs("div", {
                children: [
                  _jsx("span", {
                    className: "text-slate-500",
                    children: "Purpose:",
                  }),
                  " ",
                  viewing.purpose || "-",
                ],
              }),
              _jsxs("table", {
                className: "table-base",
                children: [
                  _jsx("thead", {
                    children: _jsxs("tr", {
                      children: [
                        _jsx("th", { children: "Item" }),
                        _jsx("th", { children: "Warehouse / Site" }),
                        _jsx("th", { children: "Physical Bin" }),
                        _jsx("th", { children: "Quantity" }),
                        _jsx("th", { children: "Value" }),
                      ],
                    }),
                  }),
                  _jsx("tbody", {
                    children: viewing.items.map((line) =>
                      _jsxs(
                        "tr",
                        {
                          children: [
                            _jsxs("td", {
                              children: [
                                line.item_code,
                                " - ",
                                line.description,
                              ],
                            }),
                            _jsxs("td", {
                              children: [
                                line.warehouse_name,
                                line.site_name ? ` — ${line.site_name}` : "",
                              ],
                            }),
                            _jsx("td", {
                              children:
                                line.location_code || "Legacy / unassigned",
                            }),
                            _jsx("td", { children: line.quantity }),
                            _jsx("td", {
                              children: formatCurrency(line.value),
                            }),
                          ],
                        },
                        line.id,
                      ),
                    ),
                  }),
                ],
              }),
                  ],
                }),
              }),
              viewing.status === "PendingApproval" &&
                canApprove &&
                _jsxs("div", {
                  className: "flex justify-end gap-2",
                  children: [
                    _jsx("button", {
                      className: "btn-secondary text-rose-600",
                      onClick: async () => {
                        await reject(viewing.id);
                        setViewing(null);
                      },
                      children: "Reject",
                    }),
                    _jsx("button", {
                      className: "btn-primary",
                      onClick: async () => {
                        await approve(viewing.id);
                        setViewing(null);
                      },
                      children: "Approve",
                    }),
                  ],
                }),
            ],
          }),
        }),
    ],
  });
}
