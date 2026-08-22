import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import client from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { currencyFieldLabel, formatCurrency } from "../../utils/currency";
import DocumentAttachments from "../../components/DocumentAttachments";
import { useAuth } from "../../contexts/AuthContext";
import ProfessionalGoodsReceiptNote from "../../components/ProfessionalGoodsReceiptNote";
import StatusBadge from "../../components/StatusBadge";
import {
  COMPANY_COPY,
  GRN_VENDOR_COPY,
  printControlledCopies,
} from "../../utils/printCopies";
import { downloadElementPdf } from "../../utils/downloadPdf";
import SearchSelect from "../../components/SearchSelect";
import EmployeePicker from "../../components/EmployeePicker";
export default function GRNPage() {
  const { user } = useAuth();
  const authorizedWarehouseIds = (user?.warehouse_ids || []).map(Number);
  const singleWarehouseId =
    authorizedWarehouseIds.length === 1 ? authorizedWarehouseIds[0] : "";
  const [grns, setGrns] = useState([]);
  const [pos, setPos] = useState([]);
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [receivedForEmployeeId, setReceivedForEmployeeId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [poId, setPoId] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [receivingWarehouseId, setReceivingWarehouseId] =
    useState(singleWarehouseId);
  const [lines, setLines] = useState([
    {
      item_id: "",
      item_search: "",
      quantity_received: 1,
      accepted_qty: 1,
      rejected_qty: 0,
      rejection_reason: "",
      unit_cost: 0,
      batch: "",
      expiry_date: "",
      warehouse_id: "",
    },
  ]);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null);
  const receivingEmployees = employees.filter((employee) => {
    if (!/warehouse/i.test(employee.department_name || "")) return false;
    if (!receivingWarehouseId) return false;
    let assigned = [];
    try { assigned = JSON.parse(employee.warehouse_ids_json || "[]").map(Number); } catch { assigned = []; }
    return Number(employee.all_warehouses_yn) === 1 || Number(employee.warehouse_id) === Number(receivingWarehouseId) || assigned.includes(Number(receivingWarehouseId));
  });
  function load() {
    client.get("/warehouse/grns").then((res) => setGrns(res.data));
  }
  useEffect(() => {
    load();
    client
      .get("/procurement/pos")
      .then((res) =>
        setPos(
          res.data.filter(
            (p) =>
              ["Approved", "Printed"].includes(p.status) &&
              !Number(p.fully_received),
          ),
        ),
      );
    client.get("/masters/operational-items").then((res) => setItems(res.data));
    client.get("/masters/locations").then((res) => setLocations(res.data));
    client.get("/masters/departments").then((res) => setDepartments(res.data));
    client.get("/masters/employee-directory").then((res) => {
      setEmployees(res.data);
      const current = res.data.find(
        (employee) => employee.name === user?.full_name,
      );
      if (current) setReceivedForEmployeeId(current.id);
    });
  }, [user?.full_name]);
  useEffect(() => {
    if (singleWarehouseId) setReceivingWarehouseId(singleWarehouseId);
  }, [singleWarehouseId]);
  function updateLine(i, key, val) {
    setLines((current) =>
      current.map((line, index) => {
        if (index !== i) return line;
        const updated = { ...line, [key]: val };
        if (key === "quantity_received") updated.accepted_qty = val;
        if (key === "accepted_qty")
          updated.rejected_qty = Math.max(0, updated.quantity_received - val);
        if (key === "rejected_qty")
          updated.accepted_qty = Math.max(0, updated.quantity_received - val);
        return updated;
      }),
    );
  }
  function itemRequiresInspection(itemId) {
    return items.find((it) => it.id === itemId)?.inspection_required_yn;
  }
  async function selectPurchaseOrder(value) {
    const selectedId = Number(value);
    setPoId(selectedId || "");
    setError("");
    if (!selectedId) {
      setLines([]);
      return;
    }
    try {
      const po = (await client.get(`/procurement/pos/${selectedId}`)).data;
      const outstandingLines = po.items
        .filter((line) => Number(line.outstanding_qty ?? line.quantity) > 0)
        .map((line) => {
          const outstanding = Number(line.outstanding_qty ?? line.quantity);
          const recommendedLocation = locations.find((location) => Number(location.id) === Number(line.last_location_id) && Number(location.warehouse_id) === Number(receivingWarehouseId));
          return {
            item_id: line.item_id,
            item_search: `${line.item_code} - ${line.description}`,
            item_code: line.item_code,
            description: line.description,
            uom: line.purchase_uom || line.uom || "",
            ordered_qty: Number(line.quantity),
            previously_received_qty: Number(line.received_qty || 0),
            outstanding_qty: outstanding,
            quantity_received: outstanding,
            accepted_qty: outstanding,
            rejected_qty: 0,
            rejection_reason: "",
            unit_cost: Number(line.price || 0),
            tax: Number(line.tax || 0),
            batch: "",
            expiry_date: "",
            warehouse_id: receivingWarehouseId,
            location_id: recommendedLocation?.id || "",
            recommended_location_code: recommendedLocation?.code || "",
          };
        });
      setLines(outstandingLines);
      if (!outstandingLines.length)
        setError("All items on this PO have already been fully received.");
    } catch (e) {
      setLines([]);
      setError(e?.response?.data?.error || "Unable to load PO items");
    }
  }
  async function submit() {
    try {
      if (!receivingWarehouseId)
        return setError("Select the receiving warehouse.");
      if (!receivedForEmployeeId)
        return setError("Select the employee responsible for this receipt.");
      await client.post("/warehouse/grns", {
        po_id: poId,
        delivery_note: deliveryNote,
        warehouse_id: receivingWarehouseId,
        received_for_employee_id: Number(receivedForEmployeeId),
        items: lines.map((line) => ({
          ...line,
          warehouse_id: receivingWarehouseId,
        })),
      });
      setShowForm(false);
      setPoId("");
      setDeliveryNote("");
      setReceivedForEmployeeId("");
      setLines([
        {
          item_id: "",
          item_search: "",
          quantity_received: 1,
          accepted_qty: 1,
          rejected_qty: 0,
          rejection_reason: "",
          unit_cost: 0,
          batch: "",
          expiry_date: "",
          warehouse_id: "",
        },
      ]);
      load();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to post GRN");
    }
  }
  async function viewGrn(id) {
    try {
      setViewing((await client.get(`/warehouse/grns/${id}`)).data);
    } catch (e) {
      setError(e?.response?.data?.error || "Unable to view GRN");
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
                children: "Goods Receipt Note (GRN)",
              }),
              _jsx("p", {
                className: "text-sm text-slate-500",
                children:
                  "Split accepted vs. rejected quantity on inspection. Only accepted quantity creates FIFO cost layers and updates stock; the item's last purchase price is updated automatically.",
              }),
            ],
          }),
          _jsx("button", {
            className: "btn-primary",
            onClick: () => setShowForm(true),
            children: "+ New GRN",
          }),
        ],
      }),
      _jsx("div", {
        className: "card",
        children: _jsx(DataTable, {
          columns: [
            { key: "grn_number", label: "GRN Number" },
            { key: "po_number", label: "PO Number" },
            { key: "supplier_name", label: "Supplier" },
            { key: "delivery_note", label: "Delivery Note" },
            {
              key: "accepted_value",
              label: "Accepted Value",
              render: (r) => formatCurrency(r.accepted_value ?? 0),
            },
            {
              key: "status",
              label: "GRN Status",
              render: (r) => _jsx(StatusBadge, { status: r.status }),
            },
            { key: "grn_date", label: "Date" },
          ],
          rows: grns,
          actions: (row) =>
            _jsx("button", {
              className: "text-brand-600 text-xs font-medium",
              onClick: () => viewGrn(row.id),
              children: "Print / Download",
            }),
        }),
      }),
      showForm &&
        _jsx(Modal, {
          title: "New GRN",
          onClose: () => setShowForm(false),
          wide: true,
          children: _jsxs("div", {
            className: "compact-form",
            children: [
              _jsxs("div", {
                className: "form-section-tinted",
                children: [
                  _jsx("h3", {
                    className: "form-section-title",
                    children: "GRN Header",
                  }),
                  _jsxs("div", {
                    className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4",
                    children: [
                      _jsx(SearchSelect, {
                        label: "Purchase Order",
                        options: pos.map((p) => ({
                          value: p.id,
                          label: `${p.po_number} — ${p.supplier_name}${p.committed_delivery_date ? ` — Due ${p.committed_delivery_date}` : ""}`,
                        })),
                        value: poId,
                        onChange: selectPurchaseOrder,
                        placeholder: "Search PO",
                      }),
                      _jsxs("div", {
                        children: [
                          _jsx("label", {
                            className: "text-sm font-medium text-slate-700",
                            children: "Receiving Warehouse",
                          }),
                          authorizedWarehouseIds.length === 1
                            ? _jsx("div", {
                                className:
                                  "input mt-1 bg-slate-100 text-slate-700",
                                children:
                                  locations.find(
                                    (location) =>
                                      Number(location.warehouse_id) ===
                                      Number(singleWarehouseId),
                                  )?.warehouse_name ||
                                  user?.warehouse_name ||
                                  "Assigned warehouse",
                              })
                            : _jsxs("select", {
                                className: "input mt-1",
                                value: receivingWarehouseId,
                                onChange: (event) => {
                                  const id = Number(event.target.value) || "";
                                  setReceivingWarehouseId(id);
                                  setLines((current) =>
                                    current.map((line) => ({
                                      ...line,
                                      warehouse_id: id,
                                      location_id: "",
                                    })),
                                  );
                                },
                                children: [
                                  _jsx("option", {
                                    value: "",
                                    children: "Select authorized warehouse...",
                                  }),
                                  Array.from(
                                    new Map(
                                      locations.map((location) => [
                                        Number(location.warehouse_id),
                                        {
                                          id: Number(location.warehouse_id),
                                          name: location.warehouse_name,
                                        },
                                      ]),
                                    ).values(),
                                  ).map((warehouse) =>
                                    _jsx(
                                      "option",
                                      {
                                        value: warehouse.id,
                                        children: warehouse.name,
                                      },
                                      warehouse.id,
                                    ),
                                  ),
                                ],
                              }),
                          _jsx("p", {
                            className: "mt-1 text-xs text-slate-500",
                            children:
                              "Controlled by the employee's active warehouse responsibility.",
                          }),
                        ],
                      }),
                      _jsxs("div", {
                        children: [
                          _jsx("label", {
                            className: "text-sm font-medium text-slate-700",
                            children: "Delivery Note",
                          }),
                          _jsx("input", {
                            className: "input mt-1",
                            value: deliveryNote,
                            onChange: (e) => setDeliveryNote(e.target.value),
                          }),
                        ],
                      }),
                      _jsx(EmployeePicker, {
                        label: "Employee responsible for receipt",
                        employees: receivingEmployees,
                        departments: departments,
                        value: receivedForEmployeeId,
                        onChange: (value) =>
                          setReceivedForEmployeeId(value ? Number(value) : ""),
                        onCreated: (employee) =>
                          setEmployees((current) => [...current, employee]),
                      }),
                    ],
                  }),
                ],
              }),
              _jsxs("div", {
                className: "form-section",
                children: [
                  _jsx("h3", {
                    className: "font-medium text-slate-800 mb-1",
                    children: "Items Received",
                  }),
                  _jsx("p", {
                    className: "mb-3 text-xs text-slate-500",
                    children:
                      "Items and outstanding quantities are filled automatically from the selected PO. Enter the actual received and inspection quantities.",
                  }),
                  _jsx("div", {
                    className: "space-y-3 mt-1",
                    children: lines.map((line, i) =>
                      _jsxs(
                        "div",
                        {
                          className: "form-line-card space-y-2",
                          children: [
                            _jsxs("div", {
                              className: "grid grid-cols-12 gap-2 items-center",
                              children: [
                                _jsxs("div", {
                                  className: "col-span-5",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children: "PO Item",
                                    }),
                                    _jsxs("div", {
                                      className: "input mt-1 bg-slate-50",
                                      children: [
                                        _jsx("strong", {
                                          children: line.item_code,
                                        }),
                                        " - ",
                                        line.description,
                                        " ",
                                        _jsxs("span", {
                                          className: "text-slate-500",
                                          children: ["(", line.uom, ")"],
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-2",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children:
                                        currencyFieldLabel("PO Unit Cost"),
                                    }),
                                    _jsx("div", {
                                      className:
                                        "input mt-1 bg-slate-100 text-right font-semibold tabular-nums",
                                      children: formatCurrency(line.unit_cost),
                                    }),
                                    _jsx("div", {
                                      className:
                                        "mt-1 text-right text-[10px] text-slate-500",
                                      children: "Locked from approved PO",
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children: "Batch Number",
                                    }),
                                    _jsx("input", {
                                      className: "input mt-1",
                                      placeholder: "Batch",
                                      value: line.batch,
                                      onChange: (e) =>
                                        updateLine(i, "batch", e.target.value),
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-2",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children: "Expiry Date",
                                    }),
                                    _jsx("input", {
                                      className: "input mt-1",
                                      type: "date",
                                      value: line.expiry_date,
                                      onChange: (e) =>
                                        updateLine(
                                          i,
                                          "expiry_date",
                                          e.target.value,
                                        ),
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            _jsxs("div", {
                              className: "grid grid-cols-12 gap-2",
                              children: [
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children: "PO Tax",
                                    }),
                                    _jsxs("div", {
                                      className:
                                        "input mt-1 bg-slate-100 text-right font-semibold tabular-nums",
                                      children: [
                                        Number(line.tax || 0).toLocaleString(
                                          undefined,
                                          { maximumFractionDigits: 2 },
                                        ),
                                        "%",
                                      ],
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children: "Accepted Net Value",
                                    }),
                                    _jsx("div", {
                                      className:
                                        "input mt-1 bg-slate-100 text-right font-semibold tabular-nums",
                                      children: formatCurrency(
                                        Number(line.accepted_qty || 0) *
                                          Number(line.unit_cost || 0),
                                      ),
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children: "Accepted Tax",
                                    }),
                                    _jsx("div", {
                                      className:
                                        "input mt-1 bg-slate-100 text-right font-semibold tabular-nums",
                                      children: formatCurrency(
                                        (Number(line.accepted_qty || 0) *
                                          Number(line.unit_cost || 0) *
                                          Number(line.tax || 0)) /
                                          100,
                                      ),
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs font-medium",
                                      children: "Accepted Gross Value",
                                    }),
                                    _jsx("div", {
                                      className:
                                        "input mt-1 bg-indigo-50 text-right font-semibold tabular-nums",
                                      children: formatCurrency(
                                        Number(line.accepted_qty || 0) *
                                          Number(line.unit_cost || 0) *
                                          (1 + Number(line.tax || 0) / 100),
                                      ),
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            _jsxs("div", {
                              children: [
                                _jsx("label", {
                                  className:
                                    "text-xs font-medium text-slate-700",
                                  children: "Put-away Storage Bin",
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
                                      children: "Select the physical Bin...",
                                    }),
                                    locations
                                      .filter(
                                        (l) =>
                                          l.type === "Bin" &&
                                          Number(l.warehouse_id) ===
                                            Number(receivingWarehouseId),
                                      )
                                      .map((l) =>
                                        _jsxs(
                                          "option",
                                          {
                                            value: l.id,
                                            children: [
                                              l.code,
                                              l.label ? ` — ${l.label}` : "",
                                            ],
                                          },
                                          l.id,
                                        ),
                                      ),
                                  ],
                                }),
                                _jsx("p", {
                                  className: "mt-1 text-[11px] text-slate-500",
                                  children:
                                    "This generated Bin ID is recorded on the GRN, FIFO layer, stock card and future issues.",
                                }),
                                line.recommended_location_code && _jsxs("p", {
                                  className: "mt-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700",
                                  children: ["Recommended from the item's latest recorded location: ", line.recommended_location_code, ". You may select another authorized Bin."],
                                }),
                              ],
                            }),
                            _jsxs("div", {
                              className: "grid grid-cols-12 gap-2 items-center",
                              children: [
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsxs("label", {
                                      className: "text-xs text-slate-500",
                                      children: [
                                        "Qty Received (",
                                        line.uom,
                                        ")",
                                      ],
                                    }),
                                    _jsx("input", {
                                      className: "input",
                                      type: "number",
                                      min: "0",
                                      max: line.outstanding_qty,
                                      value: line.quantity_received,
                                      onChange: (e) =>
                                        updateLine(
                                          i,
                                          "quantity_received",
                                          Number(e.target.value),
                                        ),
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs text-slate-500",
                                      children: "Accepted Qty",
                                    }),
                                    _jsx("input", {
                                      className: "input",
                                      type: "number",
                                      value: line.accepted_qty,
                                      onChange: (e) =>
                                        updateLine(
                                          i,
                                          "accepted_qty",
                                          Number(e.target.value),
                                        ),
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs text-slate-500",
                                      children: "Rejected Qty",
                                    }),
                                    _jsx("input", {
                                      className: "input",
                                      type: "number",
                                      value: line.rejected_qty,
                                      onChange: (e) =>
                                        updateLine(
                                          i,
                                          "rejected_qty",
                                          Number(e.target.value),
                                        ),
                                    }),
                                  ],
                                }),
                                _jsxs("div", {
                                  className: "col-span-3",
                                  children: [
                                    _jsx("label", {
                                      className: "text-xs text-slate-500",
                                      children: "Rejection Reason",
                                    }),
                                    _jsx("input", {
                                      className: "input",
                                      value: line.rejection_reason,
                                      onChange: (e) =>
                                        updateLine(
                                          i,
                                          "rejection_reason",
                                          e.target.value,
                                        ),
                                      disabled: !line.rejected_qty,
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        },
                        i,
                      ),
                    ),
                  }),
                  !poId &&
                    _jsx("div", {
                      className:
                        "rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800",
                      children: "Select a purchase order to load its items.",
                    }),
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
                    disabled: !receivingWarehouseId || !poId || !lines.length,
                    onClick: submit,
                    children: "Post GRN",
                  }),
                ],
              }),
            ],
          }),
        }),
      viewing &&
        _jsx(Modal, {
          title: `GRN - ${viewing.grn_number}`,
          onClose: () => setViewing(null),
          wide: true,
          children: _jsxs("div", {
            className: "space-y-4",
            children: [
              _jsxs("div", {
                className: "flex justify-end gap-2 print:hidden",
                children: [
                  _jsx("button", {
                    className: "btn-secondary",
                    onClick: () =>
                      downloadElementPdf(
                        "grn-print-document",
                        viewing.grn_number,
                        { copies: [COMPANY_COPY, GRN_VENDOR_COPY] },
                      ),
                    children: "Download Two-Copy PDF",
                  }),
                  _jsx("button", {
                    className: "btn-primary",
                    onClick: () =>
                      printControlledCopies(
                        "grn-print-document",
                        GRN_VENDOR_COPY,
                      ),
                    children: "Print Company + Vendor Copies",
                  }),
                ],
              }),
              _jsx(ProfessionalGoodsReceiptNote, { grn: viewing }),
              _jsx("div", {
                className: "print:hidden",
                children: _jsx(DocumentAttachments, {
                  type: "GRN",
                  documentId: viewing.id,
                }),
              }),
            ],
          }),
        }),
    ],
  });
}
