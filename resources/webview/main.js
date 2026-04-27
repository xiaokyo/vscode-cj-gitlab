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
      tabTooltip: { visible: false, text: '', top: 0, left: 0 },
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

    /**
     * 注意：显示 Tab tooltip，使用 fixed 定位避免被 .workspace-tabs 的 overflow 裁切
     * 需求来源：第14次补充 — tab悬浮展示没出来的修复
     */
    showTabTooltip(event, tab) {
      const rect = event.currentTarget.getBoundingClientRect();
      this.tabTooltip = {
        visible: true,
        text: tab.name,
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
      };
    },

    hideTabTooltip() {
      this.tabTooltip.visible = false;
    },

    /** 悬浮展示 Tab 全量信息，避免名称/分支被截断导致难以区分 */
    getWorkspaceTabTitle(tab) {
      return `${tab.name}\n分支: ${tab.branch}\n路径: ${tab.fsPath}`;
    },

    /**
     * 生成项目名的缩写用于 Tab 显示
     * 规则：按 - _ . 空格 或驼峰拆分取首字母，最多2个字符
     * 例：component-center → CC, my-frontend → MF
     */
    getTabAbbr(name) {
      if (!name) return '??';
      // 按分隔符拆分
      const parts = name.split(/[-_. ]+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      // 尝试驼峰拆分
      const camel = name.match(/[A-Z][a-z]*/g);
      if (camel && camel.length >= 2) {
        return (camel[0][0] + camel[1][0]).toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    },

    /** 格式化 Tag 日期为 YYYY/M/D */
    formatTagDate(dateString) {
      if (!dateString) return '';
      const d = new Date(dateString);
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
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
    /**
     * 注意：不再需要将激活 Tab 置顶排序，保持原始工作区顺序
     * 需求来源：第15次补充 — 不用将当前选中的tab放在最前面了
     */
    workspaceTabsOrdered() {
      return this.state.workspaceTabs || [];
    },
  },
});
