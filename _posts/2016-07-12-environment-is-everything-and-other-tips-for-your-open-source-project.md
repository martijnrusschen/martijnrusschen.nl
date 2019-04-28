---
layout: post
title:  "Environment Is Everything and Other Tips For Your Open Source Project"
date:   2016-05-13
---

In 2014, HackerOne launched their [first open source project](https://github.com/Hacker0x01/react-datepicker) and two years in, we have 50 contributors, received almost 700 stars on GitHub, and are getting daily issues and pull requests. While collaborating with the open source community can be inherently [time consuming](https://medium.com/@nayafia/we-re-in-a-brave-new-post-open-source-world-56ef46d152a3), as users of open source software we see it as a great way to give back, collaborate with developers outside HackerOne and share what we are working on.

One of the most important things to be successful is creating a friendly and open environment, being responsive on issues and pull requests, and making time to manage the workload. Open source projects don’t start as a community, but you can build one. In the early days we fixed many bugs ourselves, but nowadays we see that most bugs are fixed by others. That’s a big win for collaboration and exactly how we want this project to behave. Dedicating enough time in the beginning of the project will pay you back later on when you reach a critical mass. For example, React started as a company project by Facebook and Rails was once just a one man show by David Heinemeier Hansson.

## Create the best open source environment
As the maintainer of an open source project, you should provide your collaborators with a decent set of tools to work with. This ensures you’ll receive more pull requests with bug fixes and new features. Receiving external pull requests is the best thing that can happen to your project because it signals engagement.

From the [open source projects I worked in](https://github.com/martijnrusschen), I have found the ones with the best development environments are the most attractive. In HackerOne’s Datepicker project, we started with a simple example page that loaded the external code into an HTML file that was hosted inside the project. Later on, we refactored this into a full React App which can be used as a starting point for your own local development work. Having a great development environment, together with a clean API are the key things to think of when starting your own project.

Some things we did to help other to work on this project:
- **Linters** — Everyone has their own preferences for coding, but by adding linters to enforce to most important things, you can make sure your codebase stays in a healthy state. In our case, we use [JavaScript](http://eslint.org/) and [CSS](https://github.com/brigade/scss-lint) linters for syntax checks and enforcing a default code style.
- **Tests** — You don’t want someone to submit a pull request with a bug fix that breaks something else. Aim for great test coverage (93% and counting at this moment) with the latest test frameworks. We use [Karma](https://github.com/karma-runner/karma) as a test runner together with [Istanbul](https://github.com/karma-runner/karma-coverage) to calculate the test coverage.
- **Continuous Integration** — Use Travis or CircleCI to run automated tests, linters and coverage tools on your pull request. We’ve configured our coverage tool in a way that forces you to cover at least 75% of your new code with tests.

Some things that we haven’t done yet, but are still on our list:
- **API** — Be aware of feature bloat. Don’t have 4 features all doing nearly the same thing. Write a clean API which everyone can use and that extends to build new features. A simple API is easier to maintain and makes your project much more approachable to both consumers and contributors.
- **Documentation** — Have the best documentation possible to make it easy for new users to discover the features and usage of your project. If you’re using React, use [react-docgen](https://github.com/reactjs/react-docgen) to generate API documentation.

## What about bugs?
Most open source projects are side projects for the people who contribute to them. If it’s too time-consuming or too difficult, people won’t want to contribute. However, if you create a friendly and powerful environment for others to work in, the collaboration starts automatically.

For HackerOne, one of the greatest benefits of using an open source project is finding new bugs with the help of contributors. As others use our project people discover and fix bugs they encounter, contributing to a better component that we also benefit from.

## Be responsive–especially to your biggest contributors
We can’t stress enough the importance of being responsive. You owe it to your project and contributors. You don’t want your project to die a slow death, which is exactly what it will eventually do if you don’t respond quickly to your most eager contributors.

At HackerOne we noticed one of our contributors was especially involved. A few months ago, [Rafee](https://github.com/rafeememon) offered his help in the long term, so we made him a co-owner of the project. He now has direct push access and is helping make our project more successful.

These types of collaborations are the benefit of open source. Thanks to a great development environment, we can focus on helping people collaborate and finding answers for people who have questions. I’ve seen many issues where people were helping each other without any assistance from us. This is the benefit of open source!

Are you interested in participating in HackerOne’s Datepicker project? Go to [https://github.com/Hacker0x01/react-datepicker](https://github.com/Hacker0x01/react-datepicker) and check out our issues page.

—

This post was previously posted on the [HackerOne blog](https://hackerone.com/blog/environment-is-everything-and-other-tips-for-your-open-source-project).