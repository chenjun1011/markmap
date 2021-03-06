(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(['d3'], factory);
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory(require('d3'));
  } else {
    // Browser globals (root is window)
    root.markmap = factory(root.d3);
  }
}(this, function (d3) {

  var assign = Object.assign || function(dst, src) {
      // poor man's Object.assign()
      for (var k in src) {
        if (src.hasOwnProperty(k)) {
          dst[k] = src[k];
        }
      }
      return dst;
    };

  function traverseMinDistance(node) {
    var val = Infinity;
    if (node.children) {
      val = Math.min.apply(null, node.children.map(traverseMinDistance));
      if (node.children.length > 1) {
        val = Math.min(val, Math.abs(node.children[0].x - node.children[1].x));
      }
    }
    return val;
  }

  function getLabelWidth(d) {
    // constant ratio for now, needs to be measured based on font
    return d.name.length * 5;
  }

  function traverseLabelWidth(d, offset) {
    d.y += offset;
    if (d.name !== '' && d.children && d.children.length === 1 && d.children[0].name === '') {
      var child = d.children[0];
      offset += d.y + getLabelWidth(d) - child.y;
      child.y += offset;
      if (child.children) {
        child.children.forEach(function(c) {
          traverseLabelWidth(c, offset);
        });
      }
    }
  }

  function traverseBranchId(node, branch) {
    node.branch = branch;
    if (node.children) {
      node.children.forEach(function(d) {
        traverseBranchId(d, branch);
      });
    }
  }

  function collapse(data, depth) {
    if (!data) {
      return;
    }
    data.forEach(function(d, i) {
      if (d.depth >= depth) {
        d._children = d.children;
        d.children = null;
        return;
      }
      collapse(d.children, depth);
    });
  }

  function expand(data){
    if (!data) {
      return;
    }
    data.forEach(function(d, i) {
      if (d._children) {
        d.children = d._children;
        d._children = null;
        return;
      }
      expand(d.children);
    });
  }

  function Markmap(svg, data, options) {
    if (!(this instanceof Markmap)) return new Markmap(svg, data, options);
    this.init(svg, data, options);
  }

  var defaultPreset = {
    nodeHeight: 20,
    nodeWidth: 200,
    spacingVertical: 10,
    spacingHorizontal: 120,
    duration: 750,
    layout: 'tree',
    color: 'gray',
    linkShape: 'diagonal',
    renderer: 'boxed',
    textIndent: 40,
    scale: [0.5, 1]
  };

  assign(Markmap.prototype, {
    getInitialState: function() {
      return {
        zoomScale: 1,
        zoomTranslate: [0, 0],
        autoFit: true
      };
    },
    presets: {
      'default': defaultPreset,
      'colorful': assign(assign({}, defaultPreset), {
        nodeHeight: 10,
        renderer: 'basic',
        color: 'category20'
      })
    },
    helperNames: ['layout', 'linkShape', 'color'],
    layouts: {
      tree: function() {
        return d3.layout.tree();
      }
    },
    linkShapes: {
      diagonal: function() {
        return d3.svg.diagonal()
          .projection(function(d) { return [d.y, d.x]; });
      },
      bracket: function() {
        return function(d) {
          return "M" + d.source.y + "," + d.source.x
            + "V" + d.target.x + "H" + d.target.y;
        };
      }
    },
    colors: assign(
      {gray: function() {return function() {return '#929292';}}},
      d3.scale
    ),
    init: function(svg, data, options) {
      options = options || {};

      svg = svg.datum ? svg : d3.select(svg);

      this.helpers = {};
      this.i = 0;
      var state = this.state = this.getInitialState();
      this.set(this.presets[options.preset || 'default']);
      state.height = svg.node().clientHeight;
      state.width = svg.node().clientWidth;
      this.set(options);

      var zoom = this.zoom = d3.behavior.zoom().scaleExtent(state.scale)
        .on("zoom", function() {
          this.updateZoom(d3.event.translate, d3.event.scale);
        }.bind(this));

      this.svg = svg
        .call(zoom)
        .append("g");

      this.updateZoom(state.zoomTranslate, state.zoomScale);

      this.setData(data);
      this.update(state.root);

      if (options.autoFit === undefined || options.autoFit === null) {
        state.autoFit = false;
      }
    },
    updateZoom: function(translate, scale) {
      var state = this.state;
      var x = translate[0];
      var y = translate[1];

      var react = this.svg.node().getBoundingClientRect();
      var realHeight = react.height;
      var realWidth = react.width;
      var width = state.width;
      var height = state.height;

      var h = (height - realHeight) / 2;
      var w = (realWidth - width) / 2;

      if (realHeight < height) {
        y = Math.min(h, Math.max(-h, y));
      } else {
        y = Math.min((realHeight + height) / 2, Math.max(h, y));
      }

      if (realWidth < width) {
        x = Math.min(width - realWidth, Math.max(0, x));
      } else {
        x = Math.min(w, Math.max(-(w+300), x));
      }

      state.zoomTranslate = [x, y];
      state.zoomScale = scale;
      this.zoom.translate(state.zoomTranslate)
        .scale(state.zoomScale);
      this.svg.attr("transform", "translate(" + state.zoomTranslate + ")" + " scale(" + state.zoomScale + ")")
    },
    set: function(values) {
      if (values.preset) {
        this.set(this.presets[values.preset]);
      }
      var state = this.state;
      var helpers = this.helpers;
      this.helperNames.forEach(function(h) {
        if (!helpers[h] || (values[h] && values[h] !== state[h])) {
          helpers[h] = this[h+'s'][values[h] || state[h]]();
        }
      }.bind(this));
      assign(state, values || {});
      return this;
    },
    setData: function(data) {
      var state = this.state;
      var depth = this.state.depth;

      if (data.children) {
        data.children.forEach(function(d, i) {
          traverseBranchId(d, i);
        });
      }

      state.root = data;
      state.root.x0 = state.height / 2;
      state.root.y0 = 0;

      if (depth) {
        collapse(data.children, depth);
      }

      return this;
    },
    update: function(source) {
      source = source || this.state.root;
      var res = this.layout(source);
      this.render(source, res.nodes, res.links);
      return this;
    },
    layout: function(source) {
      var state = this.state;
      var layout = this.helpers.layout;

      var offset = state.root.x !== undefined ? state.root.x : state.root.x0;

      // Compute the new tree layout.
      var nodes = layout.nodes(state.root).reverse(),
        links = layout.links(nodes);

      // Normalize
      var ratio = (state.nodeHeight + state.spacingVertical) / traverseMinDistance(state.root);
      offset -= state.root.x * ratio;

      nodes.forEach(function(d) {
        d.y = d.depth * (state.nodeWidth + state.spacingHorizontal);
        d.x = d.x * ratio + offset;
      });

      if (state.autoFit) {
        var minX = d3.min(nodes, function(d) {return d.x;});
        var minY = d3.min(nodes, function(d) {return d.y;});
        var maxX = d3.max(nodes, function(d) {return d.x;});
        var maxY = d3.max(nodes, function(d) {return d.y;});
        var realHeight = maxX - minX;
        var realWidth = maxY - minY;
        var scale = Math.min(state.height / realHeight, state.width / realWidth, 1);
        var translate = [(state.width-realWidth*scale)/2-minY*scale, (state.height-realHeight*scale)/2-minX*scale];
        this.updateZoom(translate, scale);
      }

      //traverseLabelWidth(root, 0);

      return {
        nodes: nodes,
        links: links
      };
    },
    render: function(source, nodes, links) {
      this.renderers[this.state.renderer].call(this, source, nodes, links);
    },
    renderers: {
      boxed: function(source, nodes, links) {
        var svg = this.svg;
        var state = this.state;
        var color = this.helpers.color;
        this.renderers.basic.call(this, source, nodes, links);
        var node = svg.selectAll("g.markmap-node");

        node.select('rect')
          .attr("y", -state.nodeHeight/2)
          .attr('rx', 10)
          .attr('ry', 10)
          .attr('height', state.nodeHeight)
          .attr('fill', function(d) { return d3.rgb(color(d.branch)).brighter(1.2); })
          .attr('stroke', function(d) { return color(d.branch); })
          .attr('stroke-width', 1);

        node.select('text')
          .attr("dy", ".3em");
        
        svg.selectAll("path.markmap-link")
          .attr('stroke-width', 1);
      },
      basic: function(source, nodes, links) {
        var svg = this.svg;
        var state = this.state;
        var color = this.helpers.color;
        var linkShape = this.helpers.linkShape;

        function linkWidth(d) {
          var depth = d.depth;
          if (d.name !== '' && d.children && d.children.length === 1 && d.children[0].name === '') {
            depth += 1;
          }
          return Math.max(6 - 2*depth, 1.5);
        }

        // Update the nodes…
        var node = svg.selectAll("g.markmap-node")
          .data(nodes, function(d) { return d.id || (d.id = ++this.i); }.bind(this));

        // Enter any new nodes at the parent's previous position.
        var nodeEnter = node.enter().append("g")
          .attr("class", "markmap-node")
          .attr("transform", function(d) { return "translate(" + source.y0 + "," + source.x0 + ")"; })
          .on("click", this.click.bind(this));

        nodeEnter.append('rect')
          .attr('class', 'markmap-node-rect')
          .attr("y", function(d) { return -linkWidth(d) / 2 })
          .attr('x', state.nodeWidth)
          .attr('width', 0)
          .attr('height', linkWidth)
          .attr('fill', function(d) { return color(d.branch); });

        nodeEnter.append("circle")
          .attr('class', 'markmap-node-circle')
          .attr('cx', state.nodeWidth)
          .attr('stroke', function(d) { return color(d.branch); })
          .attr("r", function(d) {
            return 1e-6;
          })
          .style("fill", function(d) { return d._children ? color(d.branch) : ''; });

        nodeEnter.each(function(d) {
          var self = this;
          var hasIcon = false;
          var parent = d3.select(self);
          parent.attr('class', function(d){return 'markmap-node markmap-depth-' + d.depth;});

          if (d.rules) {
            d.rules.forEach(function(rule) {
              if (rule.type === 'image') {
                hasIcon = true;
                parent.append("image")
                  .attr('class', 'href')
                  .attr("x", 10)
                  .attr("y", function(d){ return d.depth > 2 ? -18: -30;})
                  .attr("xlink:href", rule.src)
              } else if (rule.type === 'link') {
                parent.append("a")
                  .attr('class', 'markmap-node-text')
                  .attr("x", state.nodeWidth)
                  .attr("dy", "-0.5em")
                  .attr("text-anchor", function(d) { return "start"; })
                  .attr("xlink:href", rule.href)
                  .attr("target", "_blank")
                  .append("text")
                  .attr('class', 'markmap-node-text')
                  .attr("x", state.nodeWidth)
                  .attr("dy", "-0.5em")
                  .attr("text-anchor", function(d) { return "start"; })
                  .text(rule.content)
                  .attr("hasIcon", hasIcon)
                  .style("fill-opacity", 1e-6);
              } else if (rule.type === 'text') {
                parent.append("text")
                  .attr('class', 'markmap-node-text')
                  .attr("x", state.nodeWidth)
                  .attr("dy", "-0.5em")
                  .attr("text-anchor", function(d) { return "start"; })
                  .text(rule.content)
                  .attr("hasIcon", hasIcon)
                  .style("fill-opacity", 1e-6);
              }
            })
          }
        });

        // Transition nodes to their new position.
        var nodeUpdate = node.transition()
          .duration(state.duration)
          .attr("transform", function(d) { return "translate(" + d.y + "," + d.x + ")"; });

        nodeUpdate.select('rect')
          .attr('x', -1)
          .attr('width', state.nodeWidth + 2);

        nodeUpdate.select("circle")
          .attr("r", 4.5)
          .style("fill", function(d) { return d._children ? color(d.branch) : ''; })
          .style('display', function(d) {
            var hasChildren = d.children || d._children;
            return hasChildren ?  'inline' : 'none';
          });

        nodeUpdate.select("text")
          .attr("x", function(d) {
            if (this.getAttribute('hasIcon') !== 'true') {
              return 10;
            }

            if (d.depth > 2) {
              return state.textIndent;
            }

            return 45;
          })
          .style("fill-opacity", 1);

        // Transition exiting nodes to the parent's new position.
        var nodeExit = node.exit().transition()
          .duration(state.duration)
          .attr("transform", function(d) { return "translate(" + source.y + "," + source.x + ")"; })
          .remove();

        nodeExit.select('rect')
          .attr('x', state.nodeWidth)
          .attr('width', 0);

        nodeExit.select("circle")
          .attr("r", 1e-6);

        nodeExit.select("text")
          .style("fill-opacity", 1e-6)
          .attr("x", state.nodeWidth);

        // Update the links…
        var link = svg.selectAll("path.markmap-link")
          .data(links, function(d) { return d.target.id; });

        // Enter any new links at the parent's previous position.
        link.enter().insert("path", "g")
          .attr("class", "markmap-link")
          .attr('stroke', function(d) { return color(d.target.branch); })
          .attr('stroke-width', function(l) {return linkWidth(l.target);})
          .attr("d", function(d) {
            var o = {x: source.x0, y: source.y0 + state.nodeWidth};
            return linkShape({source: o, target: o});
          });

        // Transition links to their new position.
        link.transition()
          .duration(state.duration)
          .attr("d", function(d) {
            var s = {x: d.source.x, y: d.source.y + state.nodeWidth};
            var t = {x: d.target.x, y: d.target.y};
            return linkShape({source: s, target: t});
          });

        // Transition exiting nodes to the parent's new position.
        link.exit().transition()
          .duration(state.duration)
          .attr("d", function(d) {
            var o = {x: source.x, y: source.y + state.nodeWidth};
            return linkShape({source: o, target: o});
          })
          .remove();

        // Stash the old positions for transition.
        nodes.forEach(function(d) {
          d.x0 = d.x;
          d.y0 = d.y;
        });
      }
    },
    // Toggle children on click.
    click: function(d) {
      if (d.children) {
        d._children = d.children;
        d.children = null;
      } else {
        d.children = d._children;
        d._children = null;
      }
      this.update(d);
    },
    expand: function() {
      expand(this.state.root.children);
      this.update(this.state.root);
    }

  });

  return Markmap;

}));
