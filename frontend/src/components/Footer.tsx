import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-columns">
          <div className="footer-column">
            <h4>Support</h4>
            <ul>
              <li><a href="#">Help</a></li>
              <li><a href="#">Advisories</a></li>
              <li><a href="#">Status</a></li>
            </ul>
          </div>
          <div className="footer-column">
            <h4>Company</h4>
            <ul>
              <li><a href="#">About</a></li>
              <li><a href="#">Blog</a></li>
              <li><a href="#">Press</a></li>
            </ul>
          </div>
          <div className="footer-column">
            <h4>Terms</h4>
            <ul>
              <li><a href="#">Policies</a></li>
              <li><a href="#">Terms of Use</a></li>
              <li><a href="#">Code of Conduct</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
          <span>&copy; npm, Inc.</span>
        </div>
      </div>
    </footer>
  );
}
