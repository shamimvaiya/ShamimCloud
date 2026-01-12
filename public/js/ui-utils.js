/**
 * Shamim Cloud UI Utilities
 * Replaces native alert() and confirm() with Glassmorphism UI
 */

const UI_STYLES = `
    /* Toast Animation */
    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }

    /* Modal Animation */
    @keyframes zoomIn {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .shc-glass {
        background: rgba(15, 23, 42, 0.8);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
`;

// Inject Styles
const styleSheet = document.createElement("style");
styleSheet.innerText = UI_STYLES;
document.head.appendChild(styleSheet);

// Inject HTML Containers
document.addEventListener("DOMContentLoaded", () => {
    // Toast Container (Bottom Right)
    if (!document.getElementById('shc-toast-container')) {
        const tc = document.createElement('div');
        tc.id = 'shc-toast-container';
        tc.className = 'fixed bottom-5 right-5 z-50 flex flex-col gap-3 pointer-events-none';
        document.body.appendChild(tc);
    }

    // Modal Container
    if (!document.getElementById('shc-modal-container')) {
        const mc = document.createElement('div');
        mc.id = 'shc-modal-container';
        mc.className = 'fixed inset-0 z-50 hidden flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate__animated animate__fadeIn';
        mc.innerHTML = `
            <div class="shc-glass w-full max-w-sm rounded-2xl p-6 border border-gray-700 shadow-2xl animate__animated animate__zoomIn">
                <div class="text-center mb-6">
                    <div id="shc-modal-icon" class="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 bg-indigo-500/20 text-indigo-400">
                        <i class="fas fa-question text-xl"></i>
                    </div>
                    <h3 id="shc-modal-title" class="text-lg font-bold text-white mb-1">Confirm Action</h3>
                    <p id="shc-modal-desc" class="text-sm text-gray-400">Are you sure you want to proceed?</p>
                </div>
                <div class="flex gap-3">
                    <button id="shc-btn-cancel" class="flex-1 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold text-sm transition">Cancel</button>
                    <button id="shc-btn-confirm" class="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition shadow-lg shadow-indigo-500/20">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(mc);
    }
});

// --- TOAST FUNCTION ---
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('shc-toast-container');
    const toast = document.createElement('div');

    // Config based on type
    const isError = type === 'error';
    const borderColor = isError ? 'border-red-500' : 'border-green-500';
    const iconColor = isError ? 'text-red-500' : 'text-green-500';
    const iconClass = isError ? 'fa-times-circle' : 'fa-check-circle';
    const title = isError ? 'Error' : 'Success';

    toast.className = `shc-glass pointer-events-auto min-w-[300px] border-l-4 ${borderColor} text-white px-5 py-4 rounded-lg shadow-xl flex items-center gap-3 animate-[slideInRight_0.3s_ease-out]`;
    toast.innerHTML = `
        <i class="fas ${iconClass} ${iconColor} text-xl shrink-0"></i>
        <div>
            <h4 class="font-bold text-sm leading-tight">${title}</h4>
            <p class="text-xs text-gray-400 mt-0.5 font-medium">${message}</p>
        </div>
    `;

    container.appendChild(toast);

    // Auto Remove
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// --- MODAL FUNCTION (ASYNC) ---
window.openConfirm = function (title, message, confirmText = 'Confirm', isDestructive = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('shc-modal-container');
        const titleEl = document.getElementById('shc-modal-title');
        const descEl = document.getElementById('shc-modal-desc');
        const cancelBtn = document.getElementById('shc-btn-cancel');
        const confirmBtn = document.getElementById('shc-btn-confirm');
        const iconBox = document.getElementById('shc-modal-icon');

        // Setup Content
        titleEl.innerText = title;
        descEl.innerHTML = message;
        confirmBtn.innerText = confirmText;

        // Styling
        if (isDestructive) {
            confirmBtn.className = 'flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition shadow-lg shadow-red-500/20';
            iconBox.className = 'w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 bg-red-500/20 text-red-500';
            iconBox.innerHTML = '<i class="fas fa-exclamation-triangle text-xl"></i>';
        } else {
            confirmBtn.className = 'flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition shadow-lg shadow-indigo-500/20';
            iconBox.className = 'w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 bg-indigo-500/20 text-indigo-400';
            iconBox.innerHTML = '<i class="fas fa-question text-xl"></i>';
        }

        // Show
        modal.classList.remove('hidden');

        // Handlers
        const close = (val) => {
            modal.classList.add('hidden');
            resolve(val);
            cleanup();
        };

        const onConfirm = () => close(true);
        const onCancel = () => close(false);

        confirmBtn.onclick = onConfirm;
        cancelBtn.onclick = onCancel;

        // Cleanup to prevent multiple listeners
        function cleanup() {
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        }
    });
};
