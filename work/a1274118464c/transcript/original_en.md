[00:00:02] Gemini CLI is designed for any task that requires working with local files and
[00:00:04] requires working with local files and multiple tools. In this lesson, you'll
[00:00:07] multiple tools. In this lesson, you'll see how Gemini CLI works under the hood.
[00:00:09] see how Gemini CLI works under the hood. You'll also learn why working from the
[00:00:11] You'll also learn why working from the command line gives you powerful
[00:00:12] command line gives you powerful advantages over web interfaces. I hope
[00:00:15] advantages over web interfaces. I hope this lesson will spark ideas about
[00:00:16] this lesson will spark ideas about what's possible with Gemini CLI. Let's
[00:00:19] what's possible with Gemini CLI. Let's dive in. So, throughout this course, we
[00:00:21] dive in. So, throughout this course, we are going to go over different use cases
[00:00:23] are going to go over different use cases where you can use Gemini CLI to your
[00:00:25] where you can use Gemini CLI to your advantage. And it's quite vast what
[00:00:27] advantage. And it's quite vast what Gemini CLI can do. You can do it for
[00:00:30] Gemini CLI can do. You can do it for software development. You can have it
[00:00:31] software development. You can have it implement features. You can actually
[00:00:33] implement features. You can actually have it review code as a GitHub action
[00:00:35] have it review code as a GitHub action in a CI/CD pipeline. You can also use
[00:00:38] in a CI/CD pipeline. You can also use Gemini CLI for content creation. So,
[00:00:40] Gemini CLI for content creation. So, we're going to show you how you can
[00:00:41] we're going to show you how you can actually take a podcast, break it up
[00:00:44] actually take a podcast, break it up into shorts, and generate content for
[00:00:46] into shorts, and generate content for social media. And we'll use some really
[00:00:48] social media. And we'll use some really cool technologies such as Nano Banana.
[00:00:50] cool technologies such as Nano Banana. Gemini CLI can also be used for data
[00:00:53] Gemini CLI can also be used for data analysis. Later in this course, we are
[00:00:55] analysis. Later in this course, we are going to take quite a large data set of
[00:00:58] going to take quite a large data set of CSV files and actually have Gemini CLI
[00:01:01] CSV files and actually have Gemini CLI go ahead and process it. It's going to
[00:01:03] go ahead and process it. It's going to clean the data and then we're going to
[00:01:05] clean the data and then we're going to have it generate some really nice
[00:01:06] have it generate some really nice visualization dashboards for us. We're
[00:01:09] visualization dashboards for us. We're also going to show how you can actually
[00:01:11] also going to show how you can actually use Gemini CLI as a study buddy. We'll
[00:01:14] use Gemini CLI as a study buddy. We'll have Gemini CLI go over course notes for
[00:01:16] have Gemini CLI go over course notes for us, build summaries, and then build
[00:01:19] us, build summaries, and then build interactive tests to help us make sure
[00:01:21] interactive tests to help us make sure we're ready to go and have learned the
[00:01:22] we're ready to go and have learned the material. So now what you've come here
[00:01:24] material. So now what you've come here for, what is Gemini CLI? Gemini CLI is
[00:01:28] for, what is Gemini CLI? Gemini CLI is an agent that lives in the terminal.
[00:01:30] an agent that lives in the terminal. This means you can easily install it.
[00:01:32] This means you can easily install it. It's very lightweight. You can just
[00:01:33] It's very lightweight. You can just prompt and ask questions and the agent
[00:01:36] prompt and ask questions and the agent will go off, do research on your behalf.
[00:01:38] will go off, do research on your behalf. It'll find the files it needs to access
[00:01:40] It'll find the files it needs to access and read the contents and then use that
[00:01:43] and read the contents and then use that to give you a really clear response.
[00:01:45] to give you a really clear response. It's a conversational AI agent at heart
[00:01:47] It's a conversational AI agent at heart and it's meant to be an interactive
[00:01:49] and it's meant to be an interactive assistant. You're supposed to go back
[00:01:50] assistant. You're supposed to go back and forth with [clears throat] the agent
[00:01:51] and forth with [clears throat] the agent to help you accomplish and perform the
[00:01:53] to help you accomplish and perform the tasks you need. So, as we mentioned,
[00:01:55] tasks you need. So, as we mentioned, Gemini CLI is open source. The community
[00:01:58] Gemini CLI is open source. The community helps drive a lot of the feature
[00:01:59] helps drive a lot of the feature development. You can actually go and
[00:02:01] development. You can actually go and inspect every single line of code and it
[00:02:03] inspect every single line of code and it means you can actually go ahead and
[00:02:04] means you can actually go ahead and customize. You can fork the code, add in
[00:02:07] customize. You can fork the code, add in your own features, or create your own
[00:02:09] your own features, or create your own version of Gemini CLI. And finally, the
[00:02:12] version of Gemini CLI. And finally, the name kind of gives it away, but it is
[00:02:13] name kind of gives it away, but it is powered and backed by Gemini models. The
[00:02:16] powered and backed by Gemini models. The free tier actually comes with a very
[00:02:18] free tier actually comes with a very generous amount of requests. so that you
[00:02:19] generous amount of requests. so that you can actually use this tool absolutely
[00:02:21] can actually use this tool absolutely free of charge for your daily work. So
[00:02:24] free of charge for your daily work. So let's take a step back and look under
[00:02:26] let's take a step back and look under the hood of Gemini CLI so we know how it
[00:02:29] the hood of Gemini CLI so we know how it actually works. You send a prompt. This
[00:02:31] actually works. You send a prompt. This is sent to a large language model, the
[00:02:33] is sent to a large language model, the Gemini models, and it does the reasoning
[00:02:35] Gemini models, and it does the reasoning to understand what tools it needs. If it
[00:02:37] to understand what tools it needs. If it needs to process any information, if it
[00:02:40] needs to process any information, if it needs to request follow-up information
[00:02:41] needs to request follow-up information from you, the user, then it's going to
[00:02:43] from you, the user, then it's going to go ahead and actually call the tools in
[00:02:46] go ahead and actually call the tools in order to generate the proper response.
[00:02:47] order to generate the proper response. And it can go through this process
[00:02:49] And it can go through this process multiple times. So it can iterate
[00:02:51] multiple times. So it can iterate through calling different tools, getting
[00:02:53] through calling different tools, getting different information sent to it and
[00:02:54] different information sent to it and doing the reasoning on it until it is
[00:02:56] doing the reasoning on it until it is satisfied with the response before it
[00:02:58] satisfied with the response before it sends it back to you. This is really
[00:02:59] sends it back to you. This is really powerful because it means Gemini CLI can
[00:03:02] powerful because it means Gemini CLI can run for extended periods of time doing
[00:03:04] run for extended periods of time doing reasoning and looping through different
[00:03:06] reasoning and looping through different tool calls in order to build out entire
[00:03:08] tool calls in order to build out entire applications or debug really tricky
[00:03:10] applications or debug really tricky issues on your behalf so that you can
[00:03:12] issues on your behalf so that you can spend time doing what you do best and
[00:03:14] spend time doing what you do best and building. So let's take a look at the
[00:03:17] building. So let's take a look at the actual advantages of using a terminal
[00:03:19] actual advantages of using a terminal agent. The main one being that has
[00:03:21] agent. The main one being that has direct access to your file system. So
[00:03:23] direct access to your file system. So all of the files on your machine, Gemini
[00:03:26] all of the files on your machine, Gemini CLI can go and read the ones it needs to
[00:03:28] CLI can go and read the ones it needs to help answer your questions. This helps
[00:03:30] help answer your questions. This helps it be contextaware. This makes it very
[00:03:32] it be contextaware. This makes it very conversational and makes it feel like a
[00:03:34] conversational and makes it feel like a partner in a task. Another one of the
[00:03:36] partner in a task. Another one of the key advantages to a terminal based agent
[00:03:38] key advantages to a terminal based agent like Gemini CLI is that is really a
[00:03:40] like Gemini CLI is that is really a Swiss Army knife of tools. anything you
[00:03:43] Swiss Army knife of tools. anything you have installed on your local computer,
[00:03:45] have installed on your local computer, Gemini CLI's access to it can actually
[00:03:47] Gemini CLI's access to it can actually go out and install things for you. So,
[00:03:49] go out and install things for you. So, for instance, if you're deploying an
[00:03:50] for instance, if you're deploying an application or you want to check logs of
[00:03:52] application or you want to check logs of a deployed service, you can actually
[00:03:54] a deployed service, you can actually have Gemini CLI use G-Cloud to go ahead
[00:03:56] have Gemini CLI use G-Cloud to go ahead and pull those logs in. This really
[00:03:58] and pull those logs in. This really helps you stop context switching because
[00:04:00] helps you stop context switching because Gemini CLI can install the tools and
[00:04:02] Gemini CLI can install the tools and execute them on your behalf. Some use
[00:04:04] execute them on your behalf. Some use cases where this comes in handy,
[00:04:05] cases where this comes in handy, automation and scripting. instead of
[00:04:07] automation and scripting. instead of having to go learn about how to do
[00:04:08] having to go learn about how to do something, you can actually have Gemini
[00:04:10] something, you can actually have Gemini CLI just build a script and then it can
[00:04:12] CLI just build a script and then it can run it for you. One of the advantages of
[00:04:13] run it for you. One of the advantages of Gemini CLI is also its vast extensions
[00:04:16] Gemini CLI is also its vast extensions ecosystem. And this really helps Gemini
[00:04:18] ecosystem. And this really helps Gemini CLI become fully customized so that any
[00:04:20] CLI become fully customized so that any task you're trying to complete can be
[00:04:22] task you're trying to complete can be done through adding on extensions, MCP
[00:04:25] done through adding on extensions, MCP servers or custom commands. At a base
[00:04:27] servers or custom commands. At a base layer, Gemini CLI comes with a bunch of
[00:04:29] layer, Gemini CLI comes with a bunch of built-in tools. These are file systems
[00:04:31] built-in tools. These are file systems tools. List the directories, read files,
[00:04:34] tools. List the directories, read files, write to files, do search and edits.
[00:04:37] write to files, do search and edits. Another cool capability of Gemini CLI is
[00:04:39] Another cool capability of Gemini CLI is that it actually has a web search tool.
[00:04:41] that it actually has a web search tool. This is really helpful when Gemini CLI
[00:04:43] This is really helpful when Gemini CLI needs access to things that maybe were
[00:04:45] needs access to things that maybe were just released or there was things in the
[00:04:46] just released or there was things in the news. You want it to do some research on
[00:04:48] news. You want it to do some research on fresh data that it wasn't trained on. As
[00:04:51] fresh data that it wasn't trained on. As we mentioned, it also has shell tools.
[00:04:52] we mentioned, it also has shell tools. So, it can run any single application on
[00:04:54] So, it can run any single application on your machine through shell commands. So
[00:04:56] your machine through shell commands. So if you have GitHub CLI, it will go ahead
[00:04:58] if you have GitHub CLI, it will go ahead and actually run a shell command to
[00:05:00] and actually run a shell command to execute GitHub CLI and put up that pull
[00:05:02] execute GitHub CLI and put up that pull request for you. There's also other
[00:05:04] request for you. There's also other tools such as the ability to save memory
[00:05:06] tools such as the ability to save memory so that when you use Gemini CLI often,
[00:05:08] so that when you use Gemini CLI often, it can remember certain pieces of how
[00:05:10] it can remember certain pieces of how you like to customize your workflow or
[00:05:12] you like to customize your workflow or certain details that you don't want to
[00:05:14] certain details that you don't want to have to repeat on every single session.
[00:05:16] have to repeat on every single session. So, now that we've gone over the use
[00:05:17] So, now that we've gone over the use cases and the tools for Gemini CLI and
[00:05:20] cases and the tools for Gemini CLI and why it can be versatile, let's actually
[00:05:23] why it can be versatile, let's actually show it off and get it installed on our
[00:05:25] show it off and get it installed on our machines so that we can get going.
