/* See license.txt for terms of usage */

define([
    "firebug/firebug",
    "firebug/lib/trace",
    "firebug/lib/events",
    "firebug/lib/string",
    "firebug/debugger/debuggerLib",
    "firebug/debugger/script/sourceLink",
],
function(Firebug, FBTrace, Events, Str, DebuggerLib, SourceLink) {

"use strict";

// ********************************************************************************************* //
// Constants

var  Cc = Components.classes;
var Ci = Components.interfaces;

var TraceError = FBTrace.toError();
var Trace = FBTrace.to("DBG_SOURCEFILE");

// ********************************************************************************************* //
// Source File

/**
 * SourceFile instance is created for every compilation unit (i.e. a source created
 * at the back end). The instance is created by {@link SourceTool} every time a "newSource"
 * or the initial "sources" packet is received.
 */
function SourceFile(context, actor, href, isBlackBoxed)
{
    this.context = context;
    this.actor = actor;
    this.href = href;

    // xxxHonza: this field should be utilized by issue 4885.
    this.isBlackBoxed = isBlackBoxed;

    // The content type is set when 'source' packet is received (see onSourceLoaded).
    this.contentType = null;

    // xxxHonza: refactore the flag logic.
    this.compilation_unit_type = "script_tag";
    this.callbacks = [];

    // xxxHonza: will be also generated through //#sourceURL directive
    // (see also issue 7201)
    this.displayName = href;
}

SourceFile.prototype =
/** @lends SourceFile */
{
    getURL: function()
    {
        return this.href;
    },

    toString: function()
    {
        return this.href;
    },

    getSourceLength: function()
    {
        // xxxHonza: TODO
        return 0;
    },

    getLine: function(lineNo, callback)
    {
        if (this.loaded)
        {
            if (lineNo >=0 && lineNo < this.lines.length)
            {
                var source = this.lines[lineNo];
                if (callback)
                    callback(source);

                return source;
            }

            Trace.sysout("sourceFile.getLine; Line number is out of scope!");
            return;
        }

        this.loadScriptLines(function(lines)
        {
            var line;
            if (lineNo >=0 && lineNo < lines.length)
                line = lines[lineNo];

            if (callback)
                callback(line);
        });
    },

    isExecutableLine: function(lineNo)
    {
        // xxxHonza: TODO
        return false;
    },

    // xxxHonza: This method should return a promise
    loadScriptLines: function(callback)
    {
        if (this.loaded)
        {
            callback(this.lines);
            return this.lines;
        }

        // Remember the callback. There can be more callbacks if the script is
        // being loaded and more clients want it.
        this.callbacks.push(callback);

        // Ignore if the request-for-source is currently in progress.
        if (this.inProgress)
        {
            Trace.sysout("sourceFile.loadScriptLines; in-progress " + this.href);
            return;
        }

        Trace.sysout("sourceFile.loadScriptLines; Load source for: " + this.href);

        this.inProgress = true;

        // Firebug needs to be attached to the thread client to get sources.
        var threadClient = this.context.activeThread;
        if (!threadClient)
        {
            Trace.sysout("sourceFile.loadScriptLines; ERROR no thread client " + this.href);
            callback(null);
            return;
        }

        // This is the only place where source (the text) is loaded for specific URL.
        var sourceClient = threadClient.source(this);
        sourceClient.source(this.onSourceLoaded.bind(this));
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Private Helpers

    onSourceLoaded: function(response)
    {
        Trace.sysout("sourceFile.onSourceLoaded; response:", response);

        if (response.error)
        {
            TraceError.sysout("sourceFile.onSourceLoaded; ERROR " +
                response.error, response);
            return;
        }

        // Convert all line delimiters to the unix style. The source editor
        // (in the Script panel) also uses unix style and so we can compare
        // if specific text is already set in the editor.
        // See {@link ScriptView.showSource}
        var source = response.source.replace(/\r\n/gm, "\n");

        this.loaded = true;
        this.inProgress = false;
        this.lines = Str.splitLines(source);
        this.contentType = response.contentType;

        // Notify all callbacks.
        for (var i=0; i<this.callbacks.length; i++)
            this.callbacks[i](this.lines);

        // Fire also global notification.
        Events.dispatch(Firebug.modules, "onSourceLoaded", [this]);
    },

    getDisplayName: function()
    {
        return this.displayName;
    }
}

// ********************************************************************************************* //
// Static Methods (aka class methods)

SourceFile.getSourceFileByUrl = function(context, url)
{
    return context.getSourceFile(url);
};

SourceFile.findScriptForFunctionInContext = function(context, fn)
{
    var dbgGlobal = DebuggerLib.getThreadDebuggeeGlobalForContext(context);
    if (!dbgGlobal)
    {
        Trace.sysout("sourceFile.findScriptForFunctionInContext; no debugger");
        return null;
    }

    var dbgFn = dbgGlobal.makeDebuggeeValue(fn).unwrap();
    if (!dbgFn || !dbgFn.script)
    {
        // This happens e.g. for native functions.
        Trace.sysout("sourceFile.findScriptForFunctionInContext; no script", {
            fn: fn,
            dbgFn: dbgFn,
        });
        return null;
    }

    return dbgFn.script;
};

SourceFile.findSourceForFunction = function(fn, context)
{
    var script = SourceFile.findScriptForFunctionInContext(context, fn);
    return script ? SourceFile.getSourceLinkForScript(script, context) : null;
};

SourceFile.getSourceLinkForScript = function(script, context)
{
    var sourceLink = new SourceLink(script.url, script.startLine, "js");
    return sourceLink;
};

// ********************************************************************************************* //

// xxxHonza: backward compatibility, search the code and fix.
Firebug.SourceFile = SourceFile;

return SourceFile;

// ********************************************************************************************* //
});
