import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Header.css';

export default function Header() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-logo">
          <span className="header-logo-box">
            <span className="header-logo-text">npm</span>
          </span>
        </Link>

        <form className="header-search-form" onSubmit={handleSubmit}>
          <input
            className="header-search-input"
            type="text"
            placeholder="Search packages"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        <nav className="header-nav">
          <Link to="/signup" className="header-nav-link">Sign Up</Link>
          <Link to="/signin" className="header-nav-link">Sign In</Link>
        </nav>
      </div>
    </header>
  );
}
