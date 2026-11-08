---
title: 我的终端工具链，2026 版
description: 从 zsh 到 ripgrep，从 fzf 到 zoxide。只保留每天真的会敲的那十几个命令。
pubDate: 2026-10-12
tags: ['工具链', '效率']
category: 工具
series: 终端效率
---

每年清理一次 dotfiles。规则很简单：**三个月没用过的配置，删掉**。

## 核心四件套

| 工具 | 替代 | 一句话理由 |
| --- | --- | --- |
| `zsh` + `starship` | bash | 提示符能显示 git 分支和耗时 |
| `ripgrep` (`rg`) | grep | 默认忽略 `.gitignore`，快到不用等 |
| `fzf` | 手动翻历史 | `Ctrl-R` 模糊搜历史命令 |
| `zoxide` (`z`) | `cd` | 按访问频次跳目录，`z blog` 直达 |

装完之后最有感知的是 `z`。它不是路径补全，是**按你过去的访问习惯猜**。去过三次的目录，敲两个字母就能进。

## 几个每天都会用的别名

```bash
# ~/.zshrc
alias gs='git status -sb'
alias gd='git diff --stat'
alias gl='git log --oneline --graph --decorate -20'
alias ports='lsof -iTCP -sTCP:LISTEN -P -n'
alias serve='python3 -m http.server 8000'
```

`ports` 那个尤其值得记。调试端口占用时，比 `ps aux | grep` 快得多。

## 让 rg 和 fzf 联动

```bash
# 搜索内容并直接打开：rg 出结果，fzf 选，$EDITOR 打开
rg --line-number --no-heading . | fzf --delimiter : \
  --preview 'bat --style=numbers --color=always --highlight-line {2} {1}' \
  | awk -F: '{print $1":"$2}' \
  | xargs -I{} sh -c '$EDITOR +$(echo {} | cut -d: -f2) $(echo {} | cut -d: -f1)'
```

长是长了点，放进函数里就行：

```bash
fv() { ... }
```

## 那些被我删掉的

- **oh-my-zsh**：启动要 0.8 秒，而我实际只用到了其中两个插件。
- **tmux 的复杂配置**：现在只留 `set -g mouse on` 和一组快捷键。
- **各种美化插件**：提示符再花哨，也不影响我写代码的速度。

> 工具链的目标不是「看起来很专业」，而是让「想到」到「做到」之间的延迟尽量短。任何增加延迟的东西，无论多酷，都该删。

## 配置怎么管

放在一个仓库里，用软链接接回家目录：

```bash
ln -sf ~/dotfiles/zshrc ~/.zshrc
ln -sf ~/dotfiles/gitconfig ~/.gitconfig
```

换机器时 `git clone` + 两条 `ln`，五分钟恢复全部习惯。这大概是投入产出比最高的一次配置工作。
