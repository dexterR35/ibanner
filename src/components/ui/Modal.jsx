import { X } from 'lucide-react';
import { useEffect, useRef, useId } from 'react';
import { IconButton } from './Button.jsx';
import { Title } from './Title.jsx';
export function Modal({ title, children, onClose, wide = false }) {
  const titleId = useId();
  const ref = useRef(),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    const cancel = (e) => {
      e.preventDefault();
      closeRef.current();
    };
    el.addEventListener('cancel', cancel);
    return () => {
      el.removeEventListener('cancel', cancel);
      el.close();
    };
  }, []);
  return (
    <dialog aria-labelledby={titleId} ref={ref} className={`modal ${wide ? 'wide' : ''}`}>
      <div className="modal-heading">
        <Title as="h2" id={titleId}>
          {title}
        </Title>
        <IconButton onClick={onClose} label="Close dialog">
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
