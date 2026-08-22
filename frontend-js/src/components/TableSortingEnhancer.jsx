import { useEffect } from "react";

const valueOf = (cell) =>
  (
    cell?.querySelector("input,select")?.value ??
    cell?.textContent ??
    ""
  ).trim();

export default function TableSortingEnhancer() {
  useEffect(() => {
    function sortTable(event) {
      const header = event.target.closest("th"),
        table = header?.closest("table");
      if (
        !header ||
        !table ||
        table.dataset.managedSort ||
        table.closest(".controlled-print-document") ||
        header.textContent.trim().toLowerCase() === "actions"
      )
        return;
      const body = table.tBodies[0],
        index = [...header.parentElement.children].indexOf(header),
        rows = [...(body?.rows || [])];
      if (
        !rows.length ||
        rows.some((row) =>
          [...row.cells].some((cell) => Number(cell.colSpan) > 1),
        )
      )
        return;
      const direction = header.dataset.sortDirection === "asc" ? "desc" : "asc";
      [...header.parentElement.children].forEach((item) => {
        delete item.dataset.sortDirection;
        item.removeAttribute("aria-sort");
      });
      header.dataset.sortDirection = direction;
      header.setAttribute(
        "aria-sort",
        direction === "asc" ? "ascending" : "descending",
      );
      rows.sort(
        (left, right) =>
          valueOf(left.cells[index]).localeCompare(
            valueOf(right.cells[index]),
            undefined,
            { numeric: true, sensitivity: "base" },
          ) * (direction === "asc" ? 1 : -1),
      );
      rows.forEach((row) => body.appendChild(row));
    }
    document.addEventListener("click", sortTable);
    return () => document.removeEventListener("click", sortTable);
  }, []);
  return null;
}
