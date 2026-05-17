import { useState } from "react";
import { CheckIcon, CopyIcon } from "./Icons";
import "./CommandBox.css";

interface CommandBoxProps {
    command: string;
    label?: string;
    className?: string;
}

export default function CommandBox({ command, label = "Install", className }: CommandBoxProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            className={`command-box${copied ? " command-box--copied" : ""}${className ? ` ${className}` : ""}`}
            onClick={handleCopy}
            type="button"
            aria-label={`Copy ${label.toLowerCase()} command`}
        >
            <span className="command-box-label">{label}</span>
            <span className="command-box-prompt">$</span>
            <span className="command-box-value">{command}</span>
            <span
                className={`command-box-icon-slot${copied ? " command-box-icon-slot--copied" : ""}`}
            >
                {copied ? (
                    <CheckIcon className="command-box-icon" />
                ) : (
                    <CopyIcon className="command-box-icon" />
                )}
            </span>
        </button>
    );
}
