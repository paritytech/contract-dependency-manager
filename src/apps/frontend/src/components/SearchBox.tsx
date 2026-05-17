import type { FormEvent } from "react";
import "./SearchBox.css";

interface SearchBoxProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    ariaLabel?: string;
    className?: string;
}

export default function SearchBox({
    value,
    onChange,
    onSubmit,
    placeholder = "Search...",
    ariaLabel = "Search",
    className,
}: SearchBoxProps) {
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(value);
    };

    return (
        <form className={`search-box${className ? ` ${className}` : ""}`} onSubmit={handleSubmit}>
            <svg
                className="search-box-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
            >
                <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M10.5 4a6.5 6.5 0 1 0 4.07 11.57l3.43 3.43a0.75 0.75 0 1 0 1.06-1.06l-3.43-3.43A6.5 6.5 0 0 0 10.5 4Zm-5 6.5a5 5 0 1 1 10 0 5 5 0 0 1-10 0Z"
                />
            </svg>
            <input
                className="search-box-input"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                aria-label={ariaLabel}
            />
        </form>
    );
}
