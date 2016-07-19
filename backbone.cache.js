import Store from 'react-native-simple-store';
import _ from 'underscore';
import async from 'async';

module.exports = function(Backbone) {
    Backbone.Collection.prototype.cacheKey =
    Backbone.Model.prototype.cacheKey = function() {
        // cache key is based on a prefix passed to enableCache, then falls back  to 
        //a global setting on the Backbone object, and then a predefined string
        var prefix = (this._cache_options && this._cache_options.prefix) ||
                     Backbone.CACHE_PREFIX ||
                     "backbone-cache-";
        return prefix + _.result(this, 'url');
    };

    // call this method on a model that should be cached. it's job
    // is a listen for changes on the model and keep the cache up to
    // date with the latest version
    Backbone.Model.prototype.enableCache = function(options) {
        if (this._cache_enabled) return;
        this._cache_enabled = true;
        this._cache_options = options;
        // update cached version of the model any time it's synced from 
        // the server
        this.on('sync', function() {
            this.cache();
        }.bind(this), this);

        this.on('destroy', function() {
            this.evictFromCache();
        }.bind(this), this);
    };

    // a method to actually do the cache writing
    Backbone.Model.prototype.cache = function() {
        return Store.save(this.cacheKey(), this.toJSON());
    };

    Backbone.Model.prototype.evictFromCache = function() {
        this.off(undefined, undefined, this);
        return Store.delete(this.cacheKey());
    };

    Backbone.Model.prototype.restore = function(callback) {
        var model = this;

        // load cached object and inject it into the backbone model
        Store.get(this.cacheKey()).then(function(cached) {
            if (cached) model.set(cached, { silent: false });
            callback();
        }).catch(callback);
    };



    Backbone.Collection.prototype.enableCache = function(options) {
        if (this._cache_enabled) return;
        this._cache_enabled = true;
        this._cache_options = options;
        
        // when any model in the collection changes, re-cache it
        this.on('sync', function() {
            this.cache();
        }.bind(this));

        this.once('restored', function() {
            this.on('add', function(model) {
                model.cache();
                this.cache();
            }.bind(this));
        }.bind(this));

        this.on('remove', function(model) {
            this.cache();
        }.bind(this));
    };

    Backbone.Collection.prototype.cache = function() {
        return Store.save(this.cacheKey(), this.map(function(m) { return m.id; }));
    };

    Backbone.Collection.prototype.evictFromCache = function() {
        this.each(function(m){ m.evictFromCache(); });
        return Store.delete(this.cacheKey());
    };

    Backbone.Collection.prototype.restore = function(callback) {
        var collection = this;

        var done = function(err) { 
            this.trigger('restored');
            callback(err);
        }.bind(this);

        // load cached IDs, unpack into full models and inject
        // into the backbone collection
        Store.get(this.cacheKey()).then(function(cached) {
            if (!cached) return done();
            // remove any obviously invalid elements
            cached = _.compact(cached);
            
            async.map(cached, function(id, cb){
                var doc = {};
                doc[collection.model.prototype.idAttribute] = id;
                var model = new (collection.model)(doc);
                model.collection = collection;
                model.restore(function() {
                    cb(false, model);
                });
            }, function(err, models){
                if (models) collection.set(models, {silent: false});
                done(err);
            });
        }).catch(done);
    };
};
