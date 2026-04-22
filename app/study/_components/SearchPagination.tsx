"use client";

interface Props {
  currentPage: number;
  totalPages: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
}

export function SearchPagination(props: Props) {
  if (props.totalPages <= 1) return null;
  const pages = Array.from({ length: props.totalPages }, (_, i) => i + 1);
  return (
    <nav
      className="flex items-center gap-2 text-sm"
      aria-label="Search pagination"
      data-testid="search-pagination"
    >
      <span className="text-gray-600 dark:text-gray-300">Page</span>
      {pages.map((p) => {
        const active = p === props.currentPage;
        return (
          <button
            key={p}
            type="button"
            disabled={props.disabled || active}
            onClick={() => {
              if (active) return;
              props.onPageChange(p);
            }}
            className={
              active
                ? "rounded-full bg-blue-700 px-3 py-1 text-white dark:bg-blue-600"
                : "rounded-full px-3 py-1 text-blue-700 hover:underline disabled:text-gray-400 dark:text-blue-300 dark:disabled:text-gray-500"
            }
            data-testid="search-page"
            data-page={p}
            aria-current={active ? "page" : undefined}
          >
            {p}
          </button>
        );
      })}
    </nav>
  );
}
