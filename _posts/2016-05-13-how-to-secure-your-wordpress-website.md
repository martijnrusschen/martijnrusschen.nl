---
layout: post
title:  "How to secure your WordPress website"
date:   2016-05-13
---

Last year, HackerOne ran an experiment with a WordPress website. WordPress is a powerful platform with many options, including how you approach security.

From our experiment, and the [bug bounty program](https://hackerone.com/withinsecurity) we ran in parallel, here are my top security tips for securing your Wordpress site.

## [Enforce a Content Security Policy](https://wordpress.org/plugins/wp-content-security-policy/)
A Content Security Policy (CSP), gives you the ability to block control all content sources on your website. Not nearly enough people are utilizing CSP with only 0.37% of Alexa top million websites use any CSP. Enforcing a CSP can help prevent cross site scripting (XSS) and other related attacks. With this plugin you can run the CSP in test mode first to see which requests are made while browsing your site. Please make sure you tune the config until you see no errors anymore. Now you can turn on your CSP.

## [Google Apps Login](https://wordpress.org/plugins/google-apps-login/)
The login page of your WordPress website is usually one of the weakest parts. By using Google Apps login, you can use the security standard of Google to secure your login page. You gain the ability to use two-factor authentication and to enforce strong passwords if you’re an Enterprise user.

## [Use CloudFlare](https://cloudflare.com/)
Cloudflare is a CDN/DNS provider that can boost the security of your website for free. Adding Cloudflare to your website gives you the ability to use some of their cool features like adding SSL to your website (for free!). Also, Cloudflare’s DNS support protects you from security threats and DDoS attacks.

## [Offload your uploads to S3](https://wordpress.org/plugins/amazon-s3-and-cloudfront/)
Most WordPress sites are hacked because of malicious data in their uploads folder. For example, hackers will upload infected PHP files to the uploads folder and will execute scripts that can use your website to spam others. By offloading uploads to Amazon S3, we make sure malicious data can never execute on our website.

## Be aware of content injections
Most reports we received through our bug bounty program were about content injection. The severity of these issues depends on the content of your site and what can be injected, of course. There’s no real solution for these issues and we resolved them on a case-by-case basis. Check out our publicly disclosed content injection reports:

- [https://hackerone.com/reports/112955](https://hackerone.com/reports/112955)
- [https://hackerone.com/reports/111860](https://hackerone.com/reports/111860)
- [https://hackerone.com/reports/102327](https://hackerone.com/reports/102327)
- [https://hackerone.com/reports/111094](https://hackerone.com/reports/111094)
- [https://hackerone.com/reports/106350](https://hackerone.com/reports/106350)

## Turn off XMLRPC
XMLRPC is a WordPress feature that can be used for [pingbacks and trackbacks](https://codex.wordpress.org/XML-RPC_Support). However, it can also be used for [DDoS attacks](https://hackerone.com/reports/96294). Since you don’t need this feature for day-to-day blogging, it’s better to turn this off. To turn XMLRPC off, add this to your theme’s functions.php:

{% highlight php %}
add_filter('xmlrpc_methods', 'remove_xmlrpc_pingback_ping');
function remove_xmlrpc_pingback_ping($methods) {
 unset($methods['pingback.ping']);
 return $methods;
}
{% endhighlight %}

## Keep your WordPress up-to-date
Automattic, the company behind WordPress, runs a [bounty program for WordPress](https://hackerone.com/automattic). They are continuously resolving issues with security implications. It is important that you keep your WordPress installation up-to-date to ensure you are protected from known issues.

These suggestions are based on the experience we had with running a bug bounty program for a WordPress website. If you have other tips, let me know in the comments section.

Also, don’t forget to check out other cool guides like:
- [https://premium.wpmudev.org/blog/keeping-wordpress-secure-the-ultimate-guide/](https://premium.wpmudev.org/blog/keeping-wordpress-secure-the-ultimate-guide/)
- [http://www.sitepoint.com/tips-to-secure-wordpress/](http://www.sitepoint.com/tips-to-secure-wordpress/)
- [https://www.woothemes.com/2016/02/woocommerce-security-first-steps/](https://www.woothemes.com/2016/02/woocommerce-security-first-steps/)

Martijn Russchen, Product Manager HackerOne