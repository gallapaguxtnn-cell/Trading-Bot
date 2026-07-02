interface Column<T> {
  header: string;
  accessor: keyof T | ((item: T) => React.ReactNode);
  className?: string;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
}

export function Table<T extends { id?: string | number }>({ data, columns }: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border/60">
            {columns.map((col, index) => (
              <th key={index} className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, rowIndex) => (
            <tr key={item.id || rowIndex} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
              {columns.map((col, colIndex) => (
                <td key={colIndex} className="px-4 py-3">
                  {typeof col.accessor === 'function'
                    ? col.accessor(item)
                    : (item[col.accessor] as React.ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
