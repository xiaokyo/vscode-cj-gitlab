const vscode = acquireVsCodeApi();

new Vue({
  el: "#app",
  data() {
    const __INITIAL_DATA__ = window.__INITIAL_STATE__;
    console.log(
      "🚀 ~ main.js:80 ~ data ~ __INITIAL_STATE__:",
      __INITIAL_DATA__
    );

    return {
      state: __INITIAL_DATA__,
      mergeLinks: {
        test: "",
        cn: "",
        prod: "",
      },
      loading: {
        test: false,
        cn: false,
        prod: false,
      },
      mergeLinksLabel: {
        test: "测试站",
        cn: "国内站",
        prod: "COM站",
      },
    };
  },

  mounted() {
    this.listenerLinkChange();
  },

  methods: {
    /** vscode post message */
    vsPostMsg(data) {
      vscode.postMessage(data);
    },
    /** listener link */
    listenerLinkChange() {
      window.addEventListener("message", ({ data }) => {
        switch (data.type) {
          case "setLoading":
            this.loading[data.env] = data.loading;
            break;
          case "merge_link":
            this.mergeLinks[data.env] = data.link;
            break;
          default:
            break;
        }
      });
    },
  },

  computed: {
    hasMergeLinks() {
      return this.mergeLinks.test || this.mergeLinks.cn || this.mergeLinks.prod;
    }
  }
});
