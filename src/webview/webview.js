const vscode = acquireVsCodeApi();

const elements = {
    test: document.getElementById('publishBtnTest'),
    cn: document.getElementById('publishBtnCn'),
    prod: document.getElementById('publishBtnProd')
};

const commands = {
    test: 'publishToTest',
    cn: 'publishToCn',
    prod: 'publishToProd'
};

// Publish functions
Object.entries(commands).forEach(([type, command]) => {
    window[`publishTo${type.charAt(0).toUpperCase() + type.slice(1)}`] = () => {
        vscode.postMessage({ command });
    };
});

// Message handlers
const handlers = {
    setLoading: ({ loading, env }) => {
        const button = elements[env];
        if (!button) {
          return;
        }
        
        button.classList.toggle('loading', loading);
        button.disabled = loading;
    },

    merge_link: ({ link, type = '', env }) => {
        const linkId = `merge-link-${env}`;
        const mergeLink = document.getElementById(linkId);
        if (!mergeLink) {
          return;
        }

        mergeLink.style.display = 'block';
        mergeLink.querySelector('.info-value').innerHTML = `<a href="${link}">${link}</a>`;
    }
};

// Event listener
window.addEventListener('message', ({ data }) => {
    const handler = handlers[data.type];
    if (handler) {
        handler(data);
    }
});
