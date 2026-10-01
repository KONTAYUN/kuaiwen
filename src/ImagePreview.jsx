import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function ImagePreview({ url, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="image-preview"
      aria-label="图片预览"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current.close();
      }}
    >
      <div className="image-preview-content">
        <div className="image-preview-heading">
          <span>图片预览</span>
          <button className="icon-button" aria-label="关闭图片预览" onClick={() => dialog.current.close()}>
            <X size={20} />
          </button>
        </div>
        <img src={url} alt="图片大图" />
      </div>
    </dialog>
  );
}
