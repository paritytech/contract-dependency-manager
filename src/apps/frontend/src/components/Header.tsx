import { Link } from "react-router-dom";
import logo from "../assets/logo.png";
import NetworkConfig from "./NetworkConfig";
import "./Header.css";

export default function Header() {
    return (
        <header className="header">
            <div className="header-inner">
                <Link to="/" className="header-logo">
                    <img src={logo} alt="cdm logo" className="header-logo-img" />
                    <span className="header-logo-text">Contract Hub</span>
                </Link>
                <span className="header-separator">&mdash;</span>
                <NetworkConfig />
            </div>
        </header>
    );
}
