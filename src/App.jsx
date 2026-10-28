import { BrowserRouter } from 'react-router';
import AppRoutes from './app/router.jsx';
import './styles/index.css';

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
