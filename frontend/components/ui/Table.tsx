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
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-slate-700/50 text-slate-300">
          <tr>
            {columns.map((col, index) => (
              <th key={index} className={`p-4 ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700 text-slate-300">
          {data.map((item, rowIndex) => (
            <tr key={item.id || rowIndex}>
              {columns.map((col, colIndex) => (
                <td key={colIndex} className="p-4">
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
