const vscode = acquireVsCodeApi();

const FILE_EXTENSIONS = [
  // 前端文件
  'js', 'jsx', 'ts', 'tsx', 'vue',
  // 样式文件
  'less', 'css', 'scss', 'sass',
  // 配置文件
  'json', 'yaml', 'yml', 'toml',
  // 其他常见文件
  'xml', 'html', 'php',
  'sql', 'md', 'txt',
  'ini', 'conf', 'log',
  'csv', 'tsv', 'json5', 'jsonc'
];

const INDEX_FILE_REGEX = new RegExp(`/index\\.(${FILE_EXTENSIONS.join('|')})$`);

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
      pipelineInfo: __INITIAL_DATA__.latestPipeline,
      tagInfo: __INITIAL_DATA__.latestTag,
      activeMergeRequests: __INITIAL_DATA__.activeMergeRequests || [],
      pipelineMergedMRs: __INITIAL_DATA__.pipelineMergedMRs || [],
      tabSwitching: false,
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

    /** 复制分支名 */
    copyBranch() {
      this.vsPostMsg({ 
        command: 'copyBranch', 
        content: this.state.currentBranch 
      });
    },

    /** 切换工作区项目 */
    switchProject(tab) {
      if (tab.isActive) {
        return;
      }
      this.tabSwitching = true;
      this.vsPostMsg({
        command: 'switchProject',
        fsPath: tab.fsPath,
      });
    },

    /** 处理文件名显示 */
    formatFileName(file) {
      // 处理 index 文件的情况
      if (INDEX_FILE_REGEX.test(file)) {
        const parts = file.split("/");
        const folderName = parts.slice(-2)[0];
        const fileName = parts.slice(-1)[0];
        return `${folderName}/${fileName}`;
      }
      
      // 返回完整文件名（包含后缀）
      return file.split("/").pop() || '';
    },

    /** 格式化Pipeline时间 */
    formatPipelineTime(timeString) {
      if (!timeString) {
        return '';
      }
      const date = new Date(timeString);
      const now = new Date();
      const diffInMinutes = Math.floor((now - date) / (1000 * 60));
      
      if (diffInMinutes < 1) {
        return '刚刚';
      } else if (diffInMinutes < 60) {
        return `${diffInMinutes}分钟前`;
      } else if (diffInMinutes < 1440) {
        const hours = Math.floor(diffInMinutes / 60);
        return `${hours}小时前`;
      } else {
        return date.toLocaleDateString();
      }
    },

    /** 格式化Pipeline持续时间 */
    formatDuration(seconds) {
      if (!seconds) {
        return '';
      }
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    },

    /**
     * 注意：复制 MR 信息到剪贴板，包含标题、分支、链接、提交人
     * 需求来源：第8次提交（第7次补充）— MR都可复制对应的信息
     */
    copyMrInfo(mr) {
      const lines = [
        `标题: ${mr.title}`,
        `分支: ${mr.source_branch} → ${mr.target_branch}`,
        `链接: ${mr.web_url}`,
      ];
      if (mr.author) {
        lines.push(`提交人: ${mr.author.name}`);
      }
      this.vsPostMsg({ command: 'copyText', content: lines.join('\n') });
    },

    /** 格式化 MR merge_status 为可读文本 */
    formatMergeStatus(status) {
      const statusMap = {
        can_be_merged: '✅ 可合并',
        cannot_be_merged: '❌ 不可合并',
        cannot_be_merged_recheck: '❌ 不可合并',
        unchecked: '⏳ 未检查',
        checking: '🔄 检查中',
        ci_must_pass: '⏳ CI待通过',
        ci_still_running: '🔄 CI运行中',
      };
      return statusMap[status] || status;
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
          case "pipeline_status":
            this.pipelineInfo = data.pipeline;
            break;
          case "tag_status":
            this.tagInfo = data.tag;
            break;
          case "active_merge_requests":
            this.activeMergeRequests = data.mergeRequests || [];
            break;
          case "pipeline_merged_mrs":
            this.pipelineMergedMRs = data.mergeRequests || [];
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
    },
  },
});
